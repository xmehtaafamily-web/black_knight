const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const REPORTS_FILE = path.join(__dirname, "reports.json");
const BANS_FILE = path.join(__dirname, "bans.json");
const ANALYTICS_FILE = path.join(__dirname, "analytics.json");
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL }) : null;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    return [];
  }
}

function writeJson(file, rows) {
  fs.writeFileSync(file, JSON.stringify(rows, null, 2));
}

async function initDb() {
  if (!pool) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      reporter_id TEXT,
      reporter_name TEXT NOT NULL,
      reporter_gender TEXT NOT NULL,
      reporter_contact TEXT,
      reporter_contact_masked TEXT,
      match_id TEXT,
      match_name TEXT NOT NULL,
      match_contact TEXT,
      match_contact_masked TEXT,
      mode TEXT NOT NULL,
      room_id TEXT,
      reason TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open',
      created_at TIMESTAMPTZ NOT NULL,
      reviewed_at TIMESTAMPTZ
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS bans (
      id TEXT PRIMARY KEY,
      name TEXT,
      contact TEXT,
      contact_masked TEXT,
      reason TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS hourly_analytics (
      hour TEXT PRIMARY KEY,
      total INTEGER NOT NULL DEFAULT 0,
      male INTEGER NOT NULL DEFAULT 0,
      female INTEGER NOT NULL DEFAULT 0,
      peak_active INTEGER NOT NULL DEFAULT 0
    )
  `);
}

function reportFromRow(row) {
  return {
    id: row.id,
    reporterId: row.reporter_id,
    reporterName: row.reporter_name,
    reporterGender: row.reporter_gender,
    reporterContact: row.reporter_contact,
    reporterContactMasked: row.reporter_contact_masked,
    matchId: row.match_id,
    matchName: row.match_name,
    matchContact: row.match_contact,
    matchContactMasked: row.match_contact_masked,
    mode: row.mode,
    roomId: row.room_id,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
  };
}

async function listReports() {
  if (!pool) return readJson(REPORTS_FILE);

  const result = await pool.query("SELECT * FROM reports ORDER BY created_at DESC LIMIT 500");
  return result.rows.map(reportFromRow);
}

async function saveReport(report) {
  if (!pool) {
    const reports = readJson(REPORTS_FILE);
    reports.unshift(report);
    writeJson(REPORTS_FILE, reports.slice(0, 500));
    return;
  }

  await pool.query(
    `
      INSERT INTO reports (
        id, reporter_id, reporter_name, reporter_gender, reporter_contact, reporter_contact_masked,
        match_id, match_name, match_contact, match_contact_masked, mode, room_id, reason, status,
        created_at, reviewed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
    `,
    [
      report.id,
      report.reporterId,
      report.reporterName,
      report.reporterGender,
      report.reporterContact,
      report.reporterContactMasked,
      report.matchId,
      report.matchName,
      report.matchContact,
      report.matchContactMasked,
      report.mode,
      report.roomId,
      report.reason,
      report.status,
      report.createdAt,
      report.reviewedAt || null,
    ],
  );
}

async function updateReportStatus(id, status) {
  const reports = await listReports();
  const report = reports.find((item) => item.id === id);
  if (!report) return null;

  report.status = status === "reviewed" ? "reviewed" : "open";
  report.reviewedAt = report.status === "reviewed" ? new Date().toISOString() : null;

  if (!pool) {
    writeJson(REPORTS_FILE, reports);
    return report;
  }

  await pool.query("UPDATE reports SET status = $1, reviewed_at = $2 WHERE id = $3", [
    report.status,
    report.reviewedAt,
    id,
  ]);

  return report;
}

async function listBans() {
  if (!pool) return readJson(BANS_FILE);

  const result = await pool.query("SELECT * FROM bans ORDER BY created_at DESC");
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    contact: row.contact,
    contactMasked: row.contact_masked,
    reason: row.reason,
    createdAt: row.created_at,
  }));
}

async function saveBan(ban) {
  if (!pool) {
    const bans = await listBans();
    writeJson(BANS_FILE, [ban, ...bans]);
    return;
  }

  await pool.query(
    "INSERT INTO bans (id, name, contact, contact_masked, reason, created_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [ban.id, ban.name, ban.contact, ban.contactMasked, ban.reason, ban.createdAt],
  );
}

async function deleteBan(id) {
  if (!pool) {
    const bans = await listBans();
    writeJson(
      BANS_FILE,
      bans.filter((ban) => ban.id !== id),
    );
    return;
  }

  await pool.query("DELETE FROM bans WHERE id = $1", [id]);
}

async function incrementHourlyAnalytics({ hour, gender, activeUsers }) {
  if (!pool) {
    const rows = readJson(ANALYTICS_FILE);
    const row = rows.find((item) => item.hour === hour) || {
      hour,
      total: 0,
      male: 0,
      female: 0,
      peakActive: 0,
    };

    if (!rows.includes(row)) rows.push(row);
    row.total += 1;
    if (gender === "male") row.male += 1;
    if (gender === "female") row.female += 1;
    row.peakActive = Math.max(row.peakActive, activeUsers);
    writeJson(ANALYTICS_FILE, rows.slice(-500));
    return;
  }

  await pool.query(
    `
      INSERT INTO hourly_analytics (hour, total, male, female, peak_active)
      VALUES ($1, 1, $2, $3, $4)
      ON CONFLICT (hour)
      DO UPDATE SET
        total = hourly_analytics.total + 1,
        male = hourly_analytics.male + EXCLUDED.male,
        female = hourly_analytics.female + EXCLUDED.female,
        peak_active = GREATEST(hourly_analytics.peak_active, EXCLUDED.peak_active)
    `,
    [hour, gender === "male" ? 1 : 0, gender === "female" ? 1 : 0, activeUsers],
  );
}

async function listHourlyAnalytics(limit = 48) {
  if (!pool) {
    return readJson(ANALYTICS_FILE)
      .sort((a, b) => a.hour.localeCompare(b.hour))
      .slice(-limit);
  }

  const result = await pool.query(
    "SELECT hour, total, male, female, peak_active FROM hourly_analytics ORDER BY hour DESC LIMIT $1",
    [limit],
  );

  return result.rows
    .map((row) => ({
      hour: row.hour,
      total: row.total,
      male: row.male,
      female: row.female,
      peakActive: row.peak_active,
    }))
    .reverse();
}

module.exports = {
  initDb,
  listReports,
  saveReport,
  updateReportStatus,
  listBans,
  saveBan,
  deleteBan,
  incrementHourlyAnalytics,
  listHourlyAnalytics,
  usingPostgres: Boolean(pool),
};
