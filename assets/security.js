const crypto = require("crypto");

const SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const SESSION_ROTATE_MS = 6 * 60 * 60 * 1000;
const MUTE_MS = 10 * 60 * 1000;
const TEMP_BAN_MS = 60 * 60 * 1000;
const RECONNECT_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const CHAT_TTL_MS = 30 * 60 * 1000;

const sessions = new Map();
const rateBuckets = new Map();
const messageBuckets = new Map();
const mutedSessions = new Map();
const tempBans = new Map();
const blockedPairs = new Set();
const reconnectCodes = new Map();
const moderationEvents = [];
const recentChatSnippets = new Map();

const abusiveWords = [
  "abuse",
  "kill",
  "rape",
  "nude",
  "sex",
  "fuck",
  "bitch",
  "madarchod",
  "bhenchod",
  "chutiya",
  "mc",
  "bc",
];

const suspiciousLinkPattern = /(https?:\/\/|www\.|t\.me\/|wa\.me\/|bit\.ly|tinyurl|telegram|whatsapp)/i;
const phonePattern = /(?:\+?\d[\s-]?){8,}/;
const emailPattern = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;

function now() {
  return Date.now();
}

function randomId(prefix = "gs") {
  return `${prefix}_${crypto.randomBytes(18).toString("base64url")}`;
}

function hashValue(value) {
  const salt = process.env.SECURITY_HASH_SALT || "black-knight-dev-salt-change-on-render";
  return crypto.createHash("sha256").update(`${salt}:${value || "unknown"}`).digest("hex");
}

function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    String(cookieHeader)
      .split(";")
      .map((item) => item.trim())
      .filter(Boolean)
      .map((item) => {
        const index = item.indexOf("=");
        return [item.slice(0, index), decodeURIComponent(item.slice(index + 1))];
      }),
  );
}

function getIp(req) {
  return String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "")
    .split(",")[0]
    .trim();
}

function getDeviceFingerprint(req) {
  const agent = req.headers["user-agent"] || "";
  const lang = req.headers["accept-language"] || "";
  const platform = req.headers["sec-ch-ua-platform"] || "";
  return hashValue(`${agent}|${lang}|${platform}`);
}

function event(type, data = {}) {
  moderationEvents.unshift({
    id: crypto.randomUUID(),
    type,
    createdAt: new Date().toISOString(),
    ...data,
  });
  moderationEvents.splice(500);
}

function getOrCreateGuestSession(req, res) {
  const cookies = parseCookies(req.headers.cookie);
  const currentId = cookies.bk_guest;
  const current = currentId ? sessions.get(currentId) : null;
  const ipHash = hashValue(getIp(req));
  const deviceFingerprint = getDeviceFingerprint(req);
  const ban = tempBans.get(ipHash) || tempBans.get(deviceFingerprint);

  if (ban && ban.expiresAt > now()) {
    return {
      id: currentId || randomId(),
      banned: true,
      banReason: ban.reason,
      ipHash,
      deviceFingerprint,
      riskScore: 100,
    };
  }

  const shouldRotate =
    !current ||
    current.expiresAt <= now() ||
    current.rotateAt <= now() ||
    current.ipHash !== ipHash ||
    current.deviceFingerprint !== deviceFingerprint;

  const session = shouldRotate
    ? {
        id: randomId(),
        previousId: current?.id || "",
        createdAt: now(),
        rotateAt: now() + SESSION_ROTATE_MS,
        expiresAt: now() + SESSION_TTL_MS,
        lastSeenAt: now(),
        ipHash,
        deviceFingerprint,
        riskScore: current?.riskScore || 0,
        reportsMade: current?.reportsMade || 0,
        reportsAgainst: current?.reportsAgainst || 0,
      }
    : { ...current, lastSeenAt: now(), expiresAt: now() + SESSION_TTL_MS };

  sessions.set(session.id, session);
  if (current && current.id !== session.id) sessions.delete(current.id);

  const secure = req.headers["x-forwarded-proto"] === "https" || req.secure ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `bk_guest=${encodeURIComponent(session.id)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000,
    )}${secure}`,
  );
  return session;
}

function getSocketGuestSession(socket) {
  const cookies = parseCookies(socket.handshake.headers.cookie);
  const id = cookies.bk_guest;
  const session = id ? sessions.get(id) : null;
  if (!session || session.expiresAt <= now()) return null;
  session.lastSeenAt = now();
  return session;
}

function rateLimit(key, limit, windowMs) {
  const bucket = rateBuckets.get(key) || { count: 0, resetAt: now() + windowMs };
  if (bucket.resetAt <= now()) {
    bucket.count = 0;
    bucket.resetAt = now() + windowMs;
  }
  bucket.count += 1;
  rateBuckets.set(key, bucket);
  return {
    allowed: bucket.count <= limit,
    remaining: Math.max(0, limit - bucket.count),
    resetAt: bucket.resetAt,
  };
}

function pairKey(a, b) {
  return [a, b].filter(Boolean).sort().join(":");
}

function blockPair(a, b) {
  const key = pairKey(a, b);
  if (key) blockedPairs.add(key);
}

function isBlockedPair(a, b) {
  return blockedPairs.has(pairKey(a, b));
}

function muteSession(sessionId, reason = "spam") {
  mutedSessions.set(sessionId, { reason, expiresAt: now() + MUTE_MS });
  event("session_muted", { guestSessionId: sessionId, reason });
}

function tempBanHash(hash, reason = "abuse") {
  tempBans.set(hash, { reason, expiresAt: now() + TEMP_BAN_MS });
  event("temp_ban", { hash, reason });
}

function isMuted(sessionId) {
  const mute = mutedSessions.get(sessionId);
  if (!mute) return false;
  if (mute.expiresAt <= now()) {
    mutedSessions.delete(sessionId);
    return false;
  }
  return true;
}

function sanitizeText(value, max = 240) {
  return String(value || "")
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function analyzeMessage(session, value) {
  const text = sanitizeText(value, 240);
  if (!text) return { allowed: false, text: "", warning: "Empty message blocked.", reason: "empty" };
  if (isMuted(session.id)) return { allowed: false, text, warning: "You are temporarily muted.", reason: "muted" };

  const key = `msg:${session.id}`;
  const bucket = messageBuckets.get(key) || { messages: [], lastText: "", duplicateCount: 0 };
  bucket.messages = bucket.messages.filter((item) => now() - item.time < 10000);
  bucket.messages.push({ text, time: now() });

  if (bucket.lastText && bucket.lastText.toLowerCase() === text.toLowerCase()) bucket.duplicateCount += 1;
  else bucket.duplicateCount = 0;
  bucket.lastText = text;
  messageBuckets.set(key, bucket);

  const lower = text.toLowerCase();
  const abusive = abusiveWords.some((word) => lower.includes(word));
  const suspiciousLink = suspiciousLinkPattern.test(text);
  const personalInfo = phonePattern.test(text) || emailPattern.test(text);
  const flooding = bucket.messages.length > 8;
  const repeated = bucket.duplicateCount >= 2;

  if (flooding || repeated) {
    session.riskScore += 20;
    muteSession(session.id, flooding ? "message_flood" : "repeated_message");
    return { allowed: false, text, warning: "Spam detected. You are temporarily muted.", reason: "spam" };
  }

  if (abusive || suspiciousLink || personalInfo) {
    session.riskScore += abusive ? 16 : 10;
    event("message_flagged", {
      guestSessionId: session.id,
      reason: abusive ? "abusive" : suspiciousLink ? "suspicious_link" : "personal_info",
      preview: text.slice(0, 80),
      riskScore: session.riskScore,
    });
    if (session.riskScore >= 60) {
      muteSession(session.id, "repeated_violations");
      if (session.riskScore >= 100) tempBanHash(session.ipHash, "heavy_abuse");
    }
    return {
      allowed: false,
      text,
      warning: suspiciousLink
        ? "Links are blocked for safety."
        : personalInfo
          ? "Phone/email sharing is blocked for privacy."
          : "Abusive message blocked.",
      reason: abusive ? "abusive" : suspiciousLink ? "suspicious_link" : "personal_info",
    };
  }

  return { allowed: true, text, warning: "", reason: "" };
}

function rememberChat(roomId, message) {
  if (!roomId) return;
  const rows = recentChatSnippets.get(roomId) || [];
  rows.push({
    author: message.author || "Guest",
    text: sanitizeText(message.text || "", 120),
    createdAt: new Date().toISOString(),
  });
  recentChatSnippets.set(roomId, rows.slice(-8));
}

function getChatSnippets(roomId) {
  return recentChatSnippets.get(roomId) || [];
}

function createReconnectCode(roomId = "") {
  const code = `BK-${crypto.randomBytes(8).toString("base64url").toUpperCase()}`;
  reconnectCodes.set(code, {
    roomId,
    createdAt: now(),
    expiresAt: now() + RECONNECT_TTL_MS,
  });
  return code;
}

function validateReconnectCode(code) {
  const normalized = sanitizeText(code, 32).toUpperCase();
  const record = reconnectCodes.get(normalized);
  if (!record || record.expiresAt <= now()) {
    reconnectCodes.delete(normalized);
    return null;
  }
  return { code: normalized, ...record };
}

function cleanupSecurityState() {
  const cutoff = now();
  for (const [id, session] of sessions.entries()) if (session.expiresAt <= cutoff) sessions.delete(id);
  for (const [key, bucket] of rateBuckets.entries()) if (bucket.resetAt <= cutoff) rateBuckets.delete(key);
  for (const [id, mute] of mutedSessions.entries()) if (mute.expiresAt <= cutoff) mutedSessions.delete(id);
  for (const [hash, ban] of tempBans.entries()) if (ban.expiresAt <= cutoff) tempBans.delete(hash);
  for (const [code, record] of reconnectCodes.entries()) if (record.expiresAt <= cutoff) reconnectCodes.delete(code);
  for (const [roomId, rows] of recentChatSnippets.entries()) {
    const fresh = rows.filter((item) => new Date(item.createdAt).getTime() > cutoff - CHAT_TTL_MS);
    if (fresh.length) recentChatSnippets.set(roomId, fresh);
    else recentChatSnippets.delete(roomId);
  }
}

module.exports = {
  CHAT_TTL_MS,
  RECONNECT_TTL_MS,
  analyzeMessage,
  blockPair,
  cleanupSecurityState,
  createReconnectCode,
  event,
  getChatSnippets,
  getModerationEvents: (limit = 150) => moderationEvents.slice(0, limit),
  getOrCreateGuestSession,
  getSocketGuestSession,
  isBlockedPair,
  isMuted,
  rateLimit,
  rememberChat,
  sanitizeText,
  tempBanHash,
  validateReconnectCode,
};
