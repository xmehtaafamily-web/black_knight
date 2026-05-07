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
const security = require("./security");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: false,
  },
});

const PORT = process.env.PORT || 3000;
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "blackknight123";
const TURN_URL = process.env.TURN_URL || "";
const TURN_USERNAME = process.env.TURN_USERNAME || "";
const TURN_PASSWORD = process.env.TURN_PASSWORD || "";

const adminSessions = new Set();
const users = new Map();
const waiting = new Set();
const reconnectWaiting = new Map();
const roomCounts = new Map();
const roomMessages = new Map();
const confessions = [];

const publicRooms = [
  { id: "3am-thoughts", name: "3AM Thoughts", voiceReady: false },
  { id: "deep-talks", name: "Deep Talks", voiceReady: false },
  { id: "sad-songs", name: "Sad Songs", voiceReady: false },
  { id: "anonymous-confessions", name: "Anonymous Confessions", voiceReady: false },
  { id: "chill-zone", name: "Chill Zone", voiceReady: false },
];

app.set("trust proxy", true);

app.use((request, response, next) => {
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("X-Frame-Options", "SAMEORIGIN");
  response.setHeader("Permissions-Policy", "camera=(self), microphone=(self), geolocation=()");
  response.setHeader(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://pagead2.googlesyndication.com https://fundingchoicesmessages.google.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: https:",
      "connect-src 'self' https: wss:",
      "media-src 'self' blob:",
      "frame-src https:",
      "object-src 'none'",
    ].join("; "),
  );

  request.guestSession = security.getOrCreateGuestSession(request, response);
  if (request.guestSession?.banned) {
    response.status(403).json({ error: "Temporary safety cooldown active." });
    return;
  }
  next();
});

app.use(express.json({ limit: "16kb" }));
app.use(express.static(path.join(__dirname)));

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
    id: user.publicId,
    name: user.name,
    gender: user.gender,
    verified: false,
    mood: user.mood || "Chill",
    badges: user.badges || ["Respectful"],
    reputation: user.reputation || 72,
  };
}

function getHourKey(date = new Date()) {
  return `${date.toISOString().slice(0, 13)}:00:00.000Z`;
}

async function trackJoin(user) {
  await incrementHourlyAnalytics({
    hour: getHourKey(),
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
    if (candidate.id !== user.id && candidate.roomId === user.roomId) return candidate;
  }
  return null;
}

function findMatch(user) {
  let fallback = null;
  for (const candidateId of waiting) {
    if (candidateId === user.id) continue;
    const candidate = users.get(candidateId);
    const candidateSocket = io.sockets.sockets.get(candidateId);
    if (!candidateSocket) {
      waiting.delete(candidateId);
      continue;
    }
    if (!candidate || candidate.roomId || !preferencesFit(user, candidate)) continue;
    if (security.isBlockedPair(user.guestSessionId, candidate.guestSessionId)) continue;
    if (user.mood && candidate.mood && user.mood === candidate.mood) return candidate;
    if (!fallback) fallback = candidate;
  }
  return fallback;
}

function chooseReconnectCode(a, b, roomId) {
  if (a.savedCode && a.savedCode === b.savedCode && security.validateReconnectCode(a.savedCode)) {
    return a.savedCode;
  }
  return security.createReconnectCode(roomId);
}

function matchUsers(a, b, reconnectCode = "") {
  waiting.delete(a.id);
  waiting.delete(b.id);

  const roomId = [a.id, b.id].sort().join(":");
  const code = reconnectCode || chooseReconnectCode(a, b, roomId);
  a.roomId = roomId;
  b.roomId = roomId;

  io.sockets.sockets.get(a.id)?.join(roomId);
  io.sockets.sockets.get(b.id)?.join(roomId);

  const initiatorId = [a.id, b.id].sort()[0];
  io.to(a.id).emit("matched", {
    match: publicUser(b),
    roomId,
    reconnectCode: code,
    isInitiator: a.id === initiatorId,
  });
  io.to(b.id).emit("matched", {
    match: publicUser(a),
    roomId,
    reconnectCode: code,
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
  socket.emit("waiting", { message: "Searching another soul..." });
}

function endMatch(roomId, reason) {
  if (!roomId) return;
  for (const user of users.values()) {
    if (user.roomId === roomId) {
      user.roomId = null;
      waiting.delete(user.id);
      const socket = io.sockets.sockets.get(user.id);
      socket?.leave(roomId);
      io.to(user.id).emit("match-ended", { reason });
    }
  }
}

function leaveRoom(socket, reason = "Match disconnected.") {
  const user = users.get(socket.id);
  if (!user?.roomId) return;
  const roomId = user.roomId;
  endMatch(roomId, reason);
  for (const candidate of users.values()) {
    if (!candidate.roomId && candidate.id !== socket.id) queueUser(io.sockets.sockets.get(candidate.id));
  }
}

function queueReconnectUser(socket, code) {
  const user = users.get(socket.id);
  if (!user) return;
  const record = security.validateReconnectCode(code);
  if (!record) {
    socket.emit("waiting", { message: "Reconnect code expired or invalid." });
    return;
  }

  const normalizedCode = record.code;
  const waitingUserId = reconnectWaiting.get(normalizedCode);
  const waitingUser = waitingUserId ? users.get(waitingUserId) : null;
  const waitingSocket = waitingUserId ? io.sockets.sockets.get(waitingUserId) : null;

  user.roomId = null;
  if (!waitingSocket && waitingUserId) reconnectWaiting.delete(normalizedCode);

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

app.get("/api/guest-session", (request, response) => {
  response.json({
    guestSessionId: request.guestSession.id,
    expiresAt: request.guestSession.expiresAt,
    privacy: "Anonymous guest only. No login, email, password, or video stream is stored.",
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
  response.json(summarizeAnalytics(await listHourlyAnalytics(48)));
});

app.get("/api/admin/moderation-logs", requireAdmin, (request, response) => {
  response.json(security.getModerationEvents(150));
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
  const name = security.sanitizeText(request.body?.name || "", 24);
  const contact = security.sanitizeText(request.body?.contact || "", 64);
  const reason = security.sanitizeText(request.body?.reason || "Admin ban", 200);
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
    if ((!contact && name && user.name.toLowerCase() === name.toLowerCase()) || normalizeContact(user.contact) === normalizeContact(contact)) {
      io.to(socketId).emit("banned", { reason });
      io.sockets.sockets.get(socketId)?.disconnect(true);
    }
  }
  response.json({ ok: true });
});

app.post("/api/admin/ban-session", requireAdmin, (request, response) => {
  const hash = security.sanitizeText(request.body?.hash || request.body?.deviceFingerprint || "", 128);
  const reason = security.sanitizeText(request.body?.reason || "Admin safety ban", 200);
  if (!hash) {
    response.status(400).json({ error: "Hash is required" });
    return;
  }
  security.tempBanHash(hash, reason);
  for (const [socketId, user] of users.entries()) {
    if (user.ipHash === hash || user.deviceFingerprint === hash) {
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

app.get("/api/rooms", (request, response) => {
  response.json(
    publicRooms.map((room) => ({
      ...room,
      activeUsers: roomCounts.get(room.id) || 0,
      activity: roomMessages.get(room.id)?.length || 0,
    })),
  );
});

app.get("/api/confessions", (request, response) => {
  const page = Math.max(0, Number(request.query.page || 0));
  const approved = confessions.filter((item) => item.status === "approved");
  response.json({ items: approved.slice(page * 12, page * 12 + 12), hasMore: approved.length > page * 12 + 12 });
});

app.post("/api/confessions", (request, response) => {
  const session = request.guestSession;
  if (!security.rateLimit(`confession:${session.id}`, 3, 300000).allowed) {
    response.status(429).json({ error: "Confession limit reached." });
    return;
  }
  const result = security.analyzeMessage(session, request.body?.text || "");
  if (!result.allowed || result.text.length < 4) {
    response.status(400).json({ error: result.warning || "Confession blocked." });
    return;
  }
  const duplicate = confessions.some(
    (item) => item.guestSessionId === session.id && item.text.toLowerCase() === result.text.toLowerCase(),
  );
  if (duplicate) {
    response.status(409).json({ error: "Duplicate confession blocked." });
    return;
  }
  const confession = {
    id: crypto.randomUUID(),
    text: result.text,
    reactions: { heart: 0, fire: 0, sad: 0 },
    status: "approved",
    guestSessionId: session.id,
    createdAt: new Date().toISOString(),
  };
  confessions.unshift(confession);
  response.json(confession);
});

app.post("/api/confessions/:id/report", (request, response) => {
  const item = confessions.find((confession) => confession.id === request.params.id);
  if (!item) {
    response.status(404).json({ error: "Confession not found." });
    return;
  }
  item.status = "hidden";
  security.event("confession_reported", {
    confessionId: item.id,
    reporterGuestSessionId: request.guestSession.id,
  });
  response.json({ ok: true });
});

io.use((socket, next) => {
  const origin = socket.handshake.headers.origin;
  const host = socket.handshake.headers.host;
  if (origin && host && !origin.includes(host) && !origin.includes("onrender.com")) {
    next(new Error("Origin blocked"));
    return;
  }
  const session = security.getSocketGuestSession(socket);
  if (!session || session.banned) {
    next(new Error("Guest session required"));
    return;
  }
  socket.data.guestSession = session;
  next();
});

io.on("connection", (socket) => {
  socket.use((packet, next) => {
    const eventName = packet[0];
    const payload = packet[1] || {};
    const session = socket.data.guestSession;
    const limits = {
      join: ["start", 8, 60000],
      "join-reconnect": ["reconnect", 6, 60000],
      "chat-message": ["message", 24, 10000],
      typing: ["typing", 40, 10000],
      next: ["skip", 12, 60000],
      report: ["report", 5, 300000],
      block: ["block", 12, 60000],
      "video-signal": ["video", 90, 10000],
      "join-public-room": ["roomJoin", 8, 60000],
      "public-room-message": ["roomMessage", 18, 10000],
    };
    const limit = limits[eventName];
    if (limit && !security.rateLimit(`${limit[0]}:${session.id}`, limit[1], limit[2]).allowed) {
      socket.emit("safety-warning", { message: "Too many actions. Please wait a moment." });
      return;
    }
    if (eventName === "chat-message" || eventName === "public-room-message") {
      const result = security.analyzeMessage(session, payload.text || payload.message || "");
      if (!result.allowed) {
        socket.emit("safety-warning", { message: result.warning || "Message blocked for safety." });
        return;
      }
      payload.text = result.text;
      payload.message = result.text;
      packet[1] = payload;
    }
    next();
  });

  socket.on("join", async (profile = {}) => {
    const session = socket.data.guestSession;
    const name = security.sanitizeText(profile.name || "Guest", 24) || "Guest";
    const gender = profile.gender === "female" ? "female" : "male";
    const preference = profile.preference === "male" ? "male" : "female";
    const mode = profile.mode === "video" ? "video" : "text";
    const savedCode = security.validateReconnectCode(String(profile.savedCode || "").trim().toUpperCase())?.code || "";

    if (await isProfileBanned(name, "")) {
      socket.emit("banned", { reason: "This profile is banned." });
      socket.disconnect(true);
      return;
    }

    users.set(socket.id, {
      id: socket.id,
      publicId: crypto.randomUUID(),
      guestSessionId: session.id,
      ipHash: session.ipHash,
      deviceFingerprint: session.deviceFingerprint,
      name,
      gender,
      preference,
      mode,
      mood: security.sanitizeText(profile.mood || "Chill", 32),
      email: "",
      contact: "",
      savedCode,
      verified: false,
      badges: ["Respectful"],
      reputation: Math.max(0, 100 - session.riskScore),
      roomId: null,
    });

    await trackJoin(users.get(socket.id));
    queueUser(socket);
  });

  socket.on("join-reconnect", async (profile = {}) => {
    const session = socket.data.guestSession;
    const name = security.sanitizeText(profile.name || "Guest", 24) || "Guest";
    const mode = profile.mode === "video" ? "video" : "text";
    const code = String(profile.code || "").trim().toUpperCase();

    if (!security.validateReconnectCode(code)) {
      socket.emit("waiting", { message: "Reconnect code expired or invalid." });
      return;
    }

    users.set(socket.id, {
      id: socket.id,
      publicId: crypto.randomUUID(),
      guestSessionId: session.id,
      ipHash: session.ipHash,
      deviceFingerprint: session.deviceFingerprint,
      name,
      gender: "private",
      preference: "private",
      mode,
      mood: "Reconnect",
      email: "",
      contact: "",
      verified: false,
      badges: ["Respectful"],
      reputation: Math.max(0, 100 - session.riskScore),
      roomId: null,
    });
    await trackJoin(users.get(socket.id));
    queueReconnectUser(socket, code);
  });

  socket.on("chat-message", (payload = {}) => {
    const user = users.get(socket.id);
    if (!user?.roomId) return;
    const text = security.sanitizeText(payload.text, 180);
    if (!text) return;
    security.rememberChat(user.roomId, { author: user.publicId, text });
    socket.to(user.roomId).emit("chat-message", { from: publicUser(user), text });
  });

  socket.on("typing", (payload = {}) => {
    const user = users.get(socket.id);
    if (!user?.roomId) return;
    socket.to(user.roomId).emit("typing", { from: publicUser(user), isTyping: Boolean(payload.isTyping) });
  });

  socket.on("video-signal", (payload = {}) => {
    const user = users.get(socket.id);
    if (!user?.roomId) return;
    socket.to(user.roomId).emit("video-signal", payload);
  });

  socket.on("next", () => {
    leaveRoom(socket, "Match skipped.");
    queueUser(socket);
  });

  socket.on("block", () => {
    const user = users.get(socket.id);
    const partner = findRoomPartner(user);
    if (user?.guestSessionId && partner?.guestSessionId) security.blockPair(user.guestSessionId, partner.guestSessionId);
    leaveRoom(socket, "Match blocked.");
    queueUser(socket);
  });

  socket.on("report", async (payload = {}) => {
    const user = users.get(socket.id);
    if (!user) return;
    const partner = findRoomPartner(user);
    const category = security.sanitizeText(payload.category || payload.reason || "Abuse", 32);
    const reason = security.sanitizeText(payload.reason || category, 200);
    const roomId = user.roomId;
    if (partner?.guestSessionId) security.blockPair(user.guestSessionId, partner.guestSessionId);

    user.reputation = Math.max(0, user.reputation - 3);
    socket.data.guestSession.reportsMade += 1;
    if (partner) socket.data.guestSession.reportsAgainst += 1;

    await saveReport({
      id: crypto.randomUUID(),
      reporterId: user.publicId,
      reporterGuestSessionId: user.guestSessionId,
      reporterName: "Anonymous guest",
      reporterGender: user.gender,
      reporterContact: "",
      reporterContactMasked: "",
      matchId: partner?.publicId || "",
      targetGuestSessionId: partner?.guestSessionId || "",
      matchName: "Anonymous guest",
      matchContact: "",
      matchContactMasked: "",
      mode: user.mode,
      roomId,
      category,
      reason,
      riskScore: socket.data.guestSession.riskScore || 0,
      metadata: {
        reporterIpHash: user.ipHash,
        reporterDeviceFingerprint: user.deviceFingerprint,
        targetIpHash: partner?.ipHash || "",
        targetDeviceFingerprint: partner?.deviceFingerprint || "",
        lastMessages: security.getChatSnippets(roomId),
      },
      status: "open",
      createdAt: new Date().toISOString(),
    });

    security.event("report_saved", {
      reporterGuestSessionId: user.guestSessionId,
      targetGuestSessionId: partner?.guestSessionId || "",
      category,
      reason,
    });

    socket.emit("report-saved");
    endMatch(roomId, "This match was ended for safety after a report.");
  });

  socket.on("join-public-room", (payload = {}) => {
    const roomId = security.sanitizeText(payload.roomId || "chill-zone", 64);
    const room = publicRooms.find((item) => item.id === roomId);
    if (!room) {
      socket.emit("room-error", { message: "Room not found." });
      return;
    }
    socket.join(`public:${roomId}`);
    roomCounts.set(roomId, (roomCounts.get(roomId) || 0) + 1);
    socket.emit("public-room-joined", {
      room,
      activeUsers: roomCounts.get(roomId) || 0,
      messages: roomMessages.get(roomId) || [],
    });
    io.to(`public:${roomId}`).emit("public-room-presence", { roomId, activeUsers: roomCounts.get(roomId) || 0 });
  });

  socket.on("leave-public-room", (payload = {}) => {
    const roomId = security.sanitizeText(payload.roomId || "", 64);
    socket.leave(`public:${roomId}`);
    roomCounts.set(roomId, Math.max(0, (roomCounts.get(roomId) || 1) - 1));
    io.to(`public:${roomId}`).emit("public-room-presence", { roomId, activeUsers: roomCounts.get(roomId) || 0 });
  });

  socket.on("public-room-message", (payload = {}) => {
    const roomId = security.sanitizeText(payload.roomId || "chill-zone", 64);
    const text = security.sanitizeText(payload.text || payload.message || "", 220);
    if (!text) return;
    const message = {
      id: crypto.randomUUID(),
      roomId,
      text,
      guest: "Anonymous",
      status: "approved",
      createdAt: new Date().toISOString(),
    };
    const rows = roomMessages.get(roomId) || [];
    rows.push(message);
    roomMessages.set(roomId, rows.slice(-80));
    io.to(`public:${roomId}`).emit("public-room-message", message);
  });

  socket.on("disconnect", () => {
    waiting.delete(socket.id);
    for (const [code, socketId] of reconnectWaiting.entries()) {
      if (socketId === socket.id) reconnectWaiting.delete(code);
    }
    const user = users.get(socket.id);
    if (user?.roomId) endMatch(user.roomId, "Match disconnected.");
    users.delete(socket.id);
  });
});

setInterval(security.cleanupSecurityState, 5 * 60 * 1000).unref();

initDb()
  .then(() => {
    server.listen(PORT, () => {
      console.log(`Black_knight running on http://localhost:${PORT}`);
      console.log(`Storage: ${usingPostgres ? "PostgreSQL" : "JSON fallback"}`);
    });
  })
  .catch((error) => {
    console.error("Failed to initialize storage", error);
    process.exit(1);
  });
