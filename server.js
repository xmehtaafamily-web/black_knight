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
  usingPostgres,
} = require("./db");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "blackknight123";
const adminSessions = new Set();
const otpChallenges = new Map();
const userSessions = new Map();
const users = new Map();
const waiting = new Set();

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

function getVerifiedContact(request) {
  return userSessions.get(getCookie(request, "bk_user")) || null;
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

function preferencesFit(a, b) {
  return a.mode === b.mode && a.preference === b.gender && b.preference === a.gender;
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
    if (!candidate || candidate.roomId || !preferencesFit(user, candidate)) continue;

    return candidate;
  }

  return null;
}

function matchUsers(a, b) {
  waiting.delete(a.id);
  waiting.delete(b.id);

  const roomId = [a.id, b.id].sort().join(":");
  a.roomId = roomId;
  b.roomId = roomId;

  io.sockets.sockets.get(a.id)?.join(roomId);
  io.sockets.sockets.get(b.id)?.join(roomId);

  io.to(a.id).emit("matched", { match: publicUser(b), roomId });
  io.to(b.id).emit("matched", { match: publicUser(a), roomId });
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

app.get("/api/reports", requireAdmin, async (request, response) => {
  response.json(await listReports());
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

app.post("/api/auth/request-otp", (request, response) => {
  const contact = String(request.body?.contact || "").trim().slice(0, 64);

  if (!contact || contact.length < 5) {
    response.status(400).json({ error: "Valid email or phone is required" });
    return;
  }

  const code = String(Math.floor(100000 + Math.random() * 900000));
  otpChallenges.set(contact.toLowerCase(), {
    code,
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  console.log(`Black_knight OTP for ${contact}: ${code}`);
  response.json({
    ok: true,
    devCode: code,
    message: "OTP generated for local MVP testing.",
  });
});

app.post("/api/auth/verify", (request, response) => {
  const contact = String(request.body?.contact || "").trim().slice(0, 64);
  const code = String(request.body?.code || "").trim();
  const challenge = otpChallenges.get(contact.toLowerCase());

  if (!challenge || challenge.expiresAt < Date.now() || challenge.code !== code) {
    response.status(401).json({ error: "Invalid or expired OTP" });
    return;
  }

  otpChallenges.delete(contact.toLowerCase());

  const token = crypto.randomBytes(24).toString("hex");
  userSessions.set(token, contact);
  response.setHeader("Set-Cookie", `bk_user=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=2592000`);
  response.json({ ok: true, contact });
});

app.get("/api/auth/me", (request, response) => {
  const contact = getVerifiedContact(request);
  response.json({
    verified: Boolean(contact),
    contact,
  });
});

io.on("connection", (socket) => {
  socket.on("join", async (profile) => {
    const verifiedContact = getVerifiedContact(socket.request);
    if (!verifiedContact) {
      socket.emit("auth-required", { message: "Verify email or phone before matching." });
      return;
    }

    const name = String(profile.name || "Guest").trim().slice(0, 24) || "Guest";
    const gender = profile.gender === "female" ? "female" : "male";
    const preference = profile.preference === "male" ? "male" : "female";
    const mode = profile.mode === "video" ? "video" : "text";

    if (await isProfileBanned(name, verifiedContact)) {
      socket.emit("banned", { reason: "This verified account is banned." });
      socket.disconnect(true);
      return;
    }

    users.set(socket.id, {
      id: socket.id,
      name,
      gender,
      preference,
      mode,
      contact: verifiedContact,
      verified: true,
      roomId: null,
    });

    queueUser(socket);
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
