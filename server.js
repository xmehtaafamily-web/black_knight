const express = require("express");
const crypto = require("crypto");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");
const {
  initDb,
  listReports,
  saveReport,
  updateReportStatus,
  listBans,
  saveBan,
  deleteBan,
  incrementHourlyAnalytics,
  listHourlyAnalytics,
  usingPostgres,
} = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "blackknight123";
const TURN_URL = process.env.TURN_URL || "";
const TURN_USERNAME = process.env.TURN_USERNAME || "";
const TURN_PASSWORD = process.env.TURN_PASSWORD || "";
const adminSessions = new Set();
const users = new Map();
const waiting = new Set();
const reconnectWaiting = new Map();

app.use(express.static(path.join(__dirname)));
app.use(express.json());

function getCookie(request, name) {
  const cookies = request.headers.cookie?.split(";") || [];
  const cookie = cookies.find((item) => item.trim().startsWith(`${name}=`));
  return cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : "";
}

function isAdmin(request) {
  return adminSessions.has(getCookie(request, "bk_admin"));
}

function requireAdmin(request, response, next) {
  if (!isAdmin(request)) {
    response.status(401).json({ error: "Admin login required" });
    return;
  }

  next();
}

function normalizeContact(contact) {
  return String(contact || "").trim().toLowerCase();
}

function maskContact(contact) {
  const value = String(contact || "");
  if (!value) return "";

  if (value.includes("@")) {
    const [name, domain] = value.split("@");
    return `${name.slice(0, 2)}***@${domain}`;
  }

  return `${value.slice(0, 2)}***${value.slice(-2)}`;
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    gender: user.gender,
    verified: user.verified,
  };
}

function getHourKey(date = new Date()) {
  return date.toISOString().slice(0, 13) + ":00:00.000Z";
}

async function trackJoin(user) {
  const hourKey = getHourKey();
  await incrementHourlyAnalytics({
    hour: hourKey,
    gender: user.gender,
    activeUsers: users.size,
  });
}

function summarizeAnalytics(rows) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.total += row.total;
      acc.male += row.male;
      acc.female += row.female;
      acc.peakActive = Math.max(acc.peakActive, row.peakActive);
      return acc;
    },
    { total: 0, male: 0, female: 0, peakActive: 0 },
  );

  return { totals, rows };
}

function preferencesFit(a, b) {
  return a.mode === b.mode && a.preference === b.gender && b.preference === a.gender;
}

function createReconnectCode() {
  return `BK-${Math.floor(100000 + Math.random() * 900000)}`;
}

async function isProfileBanned(name, contact) {
  const normalizedName = String(name || "").trim().toLowerCase();
  const normalizedContact = normalizeContact(contact);
  const bans = await listBans();

  return bans.some((ban) => {
    if (ban.contact && normalizeContact(ban.contact) === normalizedContact) return true;
    return !ban.contact && ban.name?.toLowerCase() === normalizedName;
  });
}

function findRoomPartner(user) {
  if (!user?.roomId) return null;

  for (const candidate of users.values()) {
    if (candidate.id !== user.id && candidate.roomId === user.roomId) {
      return candidate;
    }
  }

  return null;
}

function findMatch(user) {
  for (const candidateId of waiting) {
    if (candidateId === user.id) continue;

    const candidate = users.get(candidateId);
    const candidateSocket = io.sockets.sockets.get(candidateId);
    if (!candidateSocket) {
      waiting.delete(candidateId);
      continue;
    }
    if (!candidate || candidate.roomId || !preferencesFit(user, candidate)) continue;

    return candidate;
  }

  return null;
}

function chooseReconnectCode(a, b) {
  if (a.savedCode && a.savedCode === b.savedCode) return a.savedCode;
  return a.savedCode || b.savedCode || createReconnectCode();
}

function matchUsers(a, b, reconnectCode = chooseReconnectCode(a, b)) {
  waiting.delete(a.id);
  waiting.delete(b.id);

  const roomId = [a.id, b.id].sort().join(":");
  a.roomId = roomId;
  b.roomId = roomId;

  io.sockets.sockets.get(a.id)?.join(roomId);
  io.sockets.sockets.get(b.id)?.join(roomId);

  const initiatorId = [a.id, b.id].sort()[0];

  io.to(a.id).emit("matched", {
    match: publicUser(b),
    roomId,
    reconnectCode,
    isInitiator: a.id === initiatorId,
  });
  io.to(b.id).emit("matched", {
    match: publicUser(a),
    roomId,
    reconnectCode,
    isInitiator: b.id === initiatorId,
  });
}

function queueUser(socket) {
  if (!socket) return;

  const user = users.get(socket.id);
  if (!user) return;

  user.roomId = null;
  const match = findMatch(user);

  if (match) {
    matchUsers(user, match);
    return;
  }

  waiting.add(user.id);
  socket.emit("waiting", { message: "Waiting for a matching user..." });
}

function leaveRoom(socket, reason = "Match disconnected.") {
  const user = users.get(socket.id);
  if (!user?.roomId) return;

  const roomId = user.roomId;
  socket.leave(roomId);
  user.roomId = null;

  for (const otherUser of users.values()) {
    if (otherUser.roomId === roomId) {
      otherUser.roomId = null;
      io.sockets.sockets.get(otherUser.id)?.leave(roomId);
      io.to(otherUser.id).emit("match-ended", { reason });
      waiting.add(otherUser.id);
      queueUser(io.sockets.sockets.get(otherUser.id));
    }
  }
}

function queueReconnectUser(socket, code) {
  const user = users.get(socket.id);
  if (!user) return;

  const normalizedCode = String(code || "").trim().toUpperCase();
  const waitingUserId = reconnectWaiting.get(normalizedCode);
  const waitingUser = waitingUserId ? users.get(waitingUserId) : null;
  const waitingSocket = waitingUserId ? io.sockets.sockets.get(waitingUserId) : null;

  user.roomId = null;

  if (!waitingSocket && waitingUserId) {
    reconnectWaiting.delete(normalizedCode);
  }

  if (waitingSocket && waitingUser && waitingUser.id !== user.id && !waitingUser.roomId && waitingUser.mode === user.mode) {
    reconnectWaiting.delete(normalizedCode);
    matchUsers(user, waitingUser, normalizedCode);
    return;
  }

  reconnectWaiting.set(normalizedCode, user.id);
  socket.emit("waiting", { message: "Waiting for the other person to enter this code..." });
}

app.post("/api/admin/login", (request, response) => {
  if (request.body?.password !== ADMIN_PASSWORD) {
    response.status(401).json({ error: "Wrong password" });
    return;
  }

  const token = crypto.randomBytes(24).toString("hex");
  adminSessions.add(token);
  response.setHeader("Set-Cookie", `bk_admin=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=86400`);
  response.json({ ok: true });
});

app.post("/api/admin/logout", requireAdmin, (request, response) => {
  adminSessions.delete(getCookie(request, "bk_admin"));
  response.setHeader("Set-Cookie", "bk_admin=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0");
  response.json({ ok: true });
});

app.get("/api/admin/me", (request, response) => {
  response.json({ loggedIn: isAdmin(request) });
});

app.get("/api/config", (request, response) => {
  response.json({
    iceServers: [
      { urls: "stun:stun.l.google.com:19302" },
      ...(TURN_URL && TURN_USERNAME && TURN_PASSWORD
        ? [{ urls: TURN_URL, username: TURN_USERNAME, credential: TURN_PASSWORD }]
        : []),
    ],
  });
});

app.get("/api/reports", requireAdmin, async (request, response) => {
  response.json(await listReports());
});

app.get("/api/admin/stats", requireAdmin, async (request, response) => {
  const reports = await listReports();
  const bans = await listBans();
  response.json({
    onlineUsers: users.size,
    waitingUsers: waiting.size,
    openReports: reports.filter((report) => (report.status || "open") === "open").length,
    totalReports: reports.length,
    totalBans: bans.length,
  });
});

app.get("/api/admin/analytics", requireAdmin, async (request, response) => {
  const rows = await listHourlyAnalytics(48);
  response.json(summarizeAnalytics(rows));
});

app.get("/api/bans", requireAdmin, async (request, response) => {
  response.json(await listBans());
});

app.patch("/api/reports/:id", requireAdmin, async (request, response) => {
  const report = await updateReportStatus(request.params.id, request.body?.status);

  if (!report) {
    response.status(404).json({ error: "Report not found" });
    return;
  }

  response.json(report);
});

app.post("/api/bans", requireAdmin, async (request, response) => {
  const name = String(request.body?.name || "").trim().slice(0, 24);
  const contact = String(request.body?.contact || "").trim().slice(0, 64);
  const reason = String(request.body?.reason || "Admin ban").trim().slice(0, 200);

  if (!name && !contact) {
    response.status(400).json({ error: "Name or contact is required" });
    return;
  }

  const bans = await listBans();
  const alreadyBanned = bans.some((ban) => {
    if (contact && ban.contact && normalizeContact(ban.contact) === normalizeContact(contact)) return true;
    return !contact && name && ban.name?.toLowerCase() === name.toLowerCase();
  });

  if (!alreadyBanned) {
    await saveBan({
      id: crypto.randomUUID(),
      name,
      contact,
      contactMasked: maskContact(contact),
      reason,
      createdAt: new Date().toISOString(),
    });
  }

  for (const [socketId, user] of users.entries()) {
    const sameContact = contact && normalizeContact(user.contact) === normalizeContact(contact);
    const sameLegacyName = !contact && name && user.name.toLowerCase() === name.toLowerCase();

    if (sameContact || sameLegacyName) {
      io.to(socketId).emit("banned", { reason });
      io.sockets.sockets.get(socketId)?.disconnect(true);
    }
  }

  response.json({ ok: true });
});

app.delete("/api/bans/:id", requireAdmin, async (request, response) => {
  await deleteBan(request.params.id);
  response.json({ ok: true });
});

io.on("connection", (socket) => {
  socket.on("join", async (profile) => {
    const name = String(profile.name || "Guest").trim().slice(0, 24) || "Guest";
    const gender = profile.gender === "female" ? "female" : "male";
    const preference = profile.preference === "male" ? "male" : "female";
    const mode = profile.mode === "video" ? "video" : "text";

    if (await isProfileBanned(name, "")) {
      socket.emit("banned", { reason: "This profile name is banned." });
      socket.disconnect(true);
      return;
    }

    users.set(socket.id, {
      id: socket.id,
      name,
      gender,
      preference,
      mode,
      email: String(profile.email || "").trim().slice(0, 64),
      deviceId: String(profile.deviceId || "").trim().slice(0, 80),
      savedCode: /^BK-\d{6}$/.test(String(profile.savedCode || "").trim().toUpperCase())
        ? String(profile.savedCode || "").trim().toUpperCase()
        : "",
      contact: "",
      verified: false,
      roomId: null,
    });

    await trackJoin(users.get(socket.id));

    queueUser(socket);
  });

  socket.on("join-reconnect", async (profile) => {
    const name = String(profile.name || "Guest").trim().slice(0, 24) || "Guest";
    const mode = profile.mode === "video" ? "video" : "text";
    const code = String(profile.code || "").trim().toUpperCase();

    if (!/^BK-\d{6}$/.test(code)) {
      socket.emit("waiting", { message: "Enter a valid reconnect code." });
      return;
    }

    if (await isProfileBanned(name, "")) {
      socket.emit("banned", { reason: "This profile name is banned." });
      socket.disconnect(true);
      return;
    }

    users.set(socket.id, {
      id: socket.id,
      name,
      gender: "private",
      preference: "private",
      mode,
      email: "",
      contact: "",
      verified: false,
      roomId: null,
    });

    await trackJoin(users.get(socket.id));

    queueReconnectUser(socket, code);
  });

  socket.on("chat-message", (payload) => {
    const user = users.get(socket.id);
    if (!user?.roomId) return;

    const text = String(payload.text || "").trim().slice(0, 180);
    if (!text) return;

    socket.to(user.roomId).emit("chat-message", {
      from: publicUser(user),
      text,
    });
  });

  socket.on("typing", (payload) => {
    const user = users.get(socket.id);
    if (!user?.roomId) return;

    socket.to(user.roomId).emit("typing", {
      from: publicUser(user),
      isTyping: Boolean(payload.isTyping),
    });
  });

  socket.on("video-signal", (payload) => {
    const user = users.get(socket.id);
    if (!user?.roomId) return;
    socket.to(user.roomId).emit("video-signal", payload);
  });

  socket.on("next", () => {
    leaveRoom(socket, "Match skipped.");
    queueUser(socket);
  });

  socket.on("block", () => {
    leaveRoom(socket, "Match blocked.");
    queueUser(socket);
  });

  socket.on("report", async (payload) => {
    const user = users.get(socket.id);
    if (!user) return;

    const partner = findRoomPartner(user);
    const report = {
      id: crypto.randomUUID(),
      reporterId: user.id,
      reporterName: user.name,
      reporterGender: user.gender,
      reporterContact: user.contact,
      reporterContactMasked: maskContact(user.contact),
      matchId: partner?.id || payload.matchId || null,
      matchName: partner?.name || payload.matchName || "Unknown",
      matchContact: partner?.contact || "",
      matchContactMasked: maskContact(partner?.contact),
      mode: user.mode,
      roomId: user.roomId,
      reason: String(payload.reason || "No reason").slice(0, 200),
      status: "open",
      createdAt: new Date().toISOString(),
    };

    await saveReport(report);
    console.log("Report received", report);
    socket.emit("report-saved");
  });

  socket.on("disconnect", () => {
    waiting.delete(socket.id);
    for (const [code, socketId] of reconnectWaiting.entries()) {
      if (socketId === socket.id) reconnectWaiting.delete(code);
    }
    leaveRoom(socket);
    users.delete(socket.id);
  });
});

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Black_knight MVP running on http://localhost:${PORT}`);
      console.log(`Storage: ${usingPostgres ? "PostgreSQL" : "JSON fallback"}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage", error);
    process.exit(1);
  });
