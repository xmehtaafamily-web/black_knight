const fs = require("fs");
const path = require("path");
const { Pool } = require("pg");

const REPORTS_FILE = path.join(__dirname, "reports.json");
const BANS_FILE = path.join(__dirname, "bans.json");
const ANALYTICS_FILE = path.join(__dirname, "analytics.json");
const RADIO_FILE = path.join(__dirname, "radio.json");
const CAMPAIGNS_FILE = path.join(__dirname, "campaigns.json");
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

  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS reporter_guest_session_id TEXT");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS target_guest_session_id TEXT");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS category TEXT");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS risk_score INTEGER DEFAULT 0");
  await pool.query("ALTER TABLE reports ADD COLUMN IF NOT EXISTS metadata JSONB DEFAULT '{}'::jsonb");

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

  await pool.query(`
    CREATE TABLE IF NOT EXISTS ad_campaigns (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      target_url TEXT NOT NULL,
      image_url TEXT,
      title TEXT,
      weight INTEGER NOT NULL DEFAULT 1,
      active BOOLEAN NOT NULL DEFAULT TRUE,
      clicks INTEGER NOT NULL DEFAULT 0,
      impressions INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL,
      updated_at TIMESTAMPTZ NOT NULL
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
    reporterGuestSessionId: row.reporter_guest_session_id,
    matchId: row.match_id,
    matchName: row.match_name,
    matchContact: row.match_contact,
    matchContactMasked: row.match_contact_masked,
    targetGuestSessionId: row.target_guest_session_id,
    mode: row.mode,
    roomId: row.room_id,
    category: row.category,
    reason: row.reason,
    riskScore: row.risk_score || 0,
    metadata: row.metadata || {},
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
        created_at, reviewed_at, reporter_guest_session_id, target_guest_session_id, category, risk_score, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21)
    `,
    [
      report.id,
      report.reporterId || "",
      report.reporterName || "Anonymous guest",
      report.reporterGender || "private",
      report.reporterContact || "",
      report.reporterContactMasked || "",
      report.matchId || "",
      report.matchName || "Anonymous guest",
      report.matchContact || "",
      report.matchContactMasked || "",
      report.mode || "text",
      report.roomId || "",
      report.reason || "No reason",
      report.status || "open",
      report.createdAt || new Date().toISOString(),
      report.reviewedAt || null,
      report.reporterGuestSessionId || "",
      report.targetGuestSessionId || "",
      report.category || "",
      report.riskScore || 0,
      report.metadata || {},
    ],
  );
}

async function updateReportStatus(id, status) {
  const reports = await listReports();
  const report = reports.find((item) => item.id === id);
  if (!report) return null;

  report.status = status === "reviewed" || status === "hidden" ? status : "open";
  report.reviewedAt = report.status === "open" ? null : new Date().toISOString();

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

const defaultRadioStations = [
  { frequency: "98.30", name: "Radio Mirchi", pageUrl: "https://onlineradiofm.com.in/radio-mirchi", streamUrl: "", locked: true },
  { frequency: "93.50", name: "Red FM", pageUrl: "https://onlineradiofm.com.in/red-fm", streamUrl: "", locked: true },
  { frequency: "92.70", name: "Big FM", pageUrl: "https://onlineradiofm.in/stations/big", streamUrl: "", locked: true },
  { frequency: "104.80", name: "Ishq FM", pageUrl: "https://onlineradiofm.in/stations/ishq", streamUrl: "", locked: true },
  { frequency: "106.40", name: "AIR FM Gold", pageUrl: "https://onlineradiofm.in/stations/fm-gold", streamUrl: "", locked: true },
];

async function listRadioStations() {
  if (!pool) {
    const rows = readJson(RADIO_FILE);
    return rows.length ? rows : defaultRadioStations;
  }

  await pool.query(`
    CREATE TABLE IF NOT EXISTS radio_stations (
      frequency TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      page_url TEXT,
      stream_url TEXT,
      locked BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL
    )
  `);

  const existing = await pool.query("SELECT frequency FROM radio_stations LIMIT 1");
  if (!existing.rows.length) {
    for (const station of defaultRadioStations) await saveRadioStation(station);
  }

  await pool.query(
    "UPDATE radio_stations SET page_url = $1, updated_at = $2 WHERE frequency = $3",
    ["https://onlineradiofm.com.in/radio-mirchi", new Date().toISOString(), "98.30"],
  );

  const result = await pool.query("SELECT * FROM radio_stations ORDER BY frequency::numeric ASC");
  return result.rows.map((row) => ({
    frequency: row.frequency,
    name: row.name,
    pageUrl: row.page_url || "",
    streamUrl: row.stream_url || "",
    locked: row.locked,
    updatedAt: row.updated_at,
  }));
}

async function saveRadioStation(station) {
  const row = {
    frequency: station.frequency,
    name: station.name,
    pageUrl: station.pageUrl || "",
    streamUrl: station.streamUrl || "",
    locked: station.locked !== false,
    updatedAt: new Date().toISOString(),
  };

  if (!pool) {
    const rows = await listRadioStations();
    const nextRows = [row, ...rows.filter((item) => item.frequency !== row.frequency)].sort(
      (a, b) => Number(a.frequency) - Number(b.frequency),
    );
    writeJson(RADIO_FILE, nextRows);
    return row;
  }

  await pool.query(
    `
      INSERT INTO radio_stations (frequency, name, page_url, stream_url, locked, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (frequency)
      DO UPDATE SET name = $2, page_url = $3, stream_url = $4, locked = $5, updated_at = $6
    `,
    [row.frequency, row.name, row.pageUrl, row.streamUrl, row.locked, row.updatedAt],
  );
  return row;
}

async function listCampaigns() {
  if (!pool) return readJson(CAMPAIGNS_FILE);
  const result = await pool.query("SELECT * FROM ad_campaigns ORDER BY created_at DESC");
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    targetUrl: row.target_url,
    imageUrl: row.image_url || "",
    title: row.title || "",
    weight: row.weight || 1,
    active: row.active,
    clicks: row.clicks || 0,
    impressions: row.impressions || 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));
}

async function saveCampaign(campaign) {
  const now = new Date().toISOString();
  const row = {
    id: campaign.id,
    name: campaign.name,
    targetUrl: campaign.targetUrl,
    imageUrl: campaign.imageUrl || "",
    title: campaign.title || campaign.name,
    weight: Math.max(1, Number(campaign.weight || 1)),
    active: campaign.active !== false,
    clicks: Number(campaign.clicks || 0),
    impressions: Number(campaign.impressions || 0),
    createdAt: campaign.createdAt || now,
    updatedAt: now,
  };

  if (!pool) {
    const rows = await listCampaigns();
    writeJson(CAMPAIGNS_FILE, [row, ...rows.filter((item) => item.id !== row.id)].slice(0, 200));
    return row;
  }

  await pool.query(
    `
      INSERT INTO ad_campaigns (id, name, target_url, image_url, title, weight, active, clicks, impressions, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      ON CONFLICT (id)
      DO UPDATE SET name = $2, target_url = $3, image_url = $4, title = $5, weight = $6, active = $7, updated_at = $11
    `,
    [row.id, row.name, row.targetUrl, row.imageUrl, row.title, row.weight, row.active, row.clicks, row.impressions, row.createdAt, row.updatedAt],
  );
  return row;
}

async function deleteCampaign(id) {
  if (!pool) {
    const rows = await listCampaigns();
    writeJson(CAMPAIGNS_FILE, rows.filter((item) => item.id !== id));
    return;
  }
  await pool.query("DELETE FROM ad_campaigns WHERE id = $1", [id]);
}

async function trackCampaignMetric(id, metric) {
  if (!["clicks", "impressions"].includes(metric)) return;
  if (!pool) {
    const rows = await listCampaigns();
    const row = rows.find((item) => item.id === id);
    if (row) row[metric] = Number(row[metric] || 0) + 1;
    writeJson(CAMPAIGNS_FILE, rows);
    return;
  }
  await pool.query(`UPDATE ad_campaigns SET ${metric} = ${metric} + 1, updated_at = $2 WHERE id = $1`, [
    id,
    new Date().toISOString(),
  ]);
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
  listRadioStations,
  saveRadioStation,
  listCampaigns,
  saveCampaign,
  deleteCampaign,
  trackCampaignMetric,
  usingPostgres: Boolean(pool),
};
