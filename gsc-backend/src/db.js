// src/db.js
//
// Postgres connection pool + helpers for the Finance Minister Hub connector.
//
// Designed to FAIL SOFT: if DATABASE_URL is not set, every helper returns
// safe defaults (0, []) and the rest of the app continues to work normally.
// This keeps the GSC reporter stateless-by-default and only enables DB
// features when a database is actually connected.

import pg from 'pg';

const { Pool } = pg;

let pool = null;
let dbReady = false;
let dbError = null;

// Initialise the pool lazily on first use. Railway injects DATABASE_URL
// automatically when a Postgres service is linked in the same project.
function getPool() {
  if (pool) return pool;
  if (!process.env.DATABASE_URL) {
    dbError = 'DATABASE_URL not set — database features disabled';
    return null;
  }
  try {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      // Railway internal Postgres does not require SSL; external does.
      // Auto-detect: if the URL contains a Railway private hostname, skip SSL.
      ssl: process.env.DATABASE_URL.includes('.railway.internal')
        ? false
        : { rejectUnauthorized: false },
      max: 5,                       // small pool — this is a low-traffic admin tool
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    pool.on('error', (err) => {
      console.error('[db] pool error:', err.message);
    });
    return pool;
  } catch (err) {
    dbError = err.message;
    console.error('[db] init failed:', err.message);
    return null;
  }
}

// Run migrations. Idempotent — safe to call on every server start.
// Creates the two tables this connector needs:
//   reports_log   — one row per /api/reports/:type successful call
//   sites_seen    — distinct sites the tool has ever queried
export async function migrate() {
  const p = getPool();
  if (!p) return;
  try {
    await p.query(`
      CREATE TABLE IF NOT EXISTS reports_log (
        id          BIGSERIAL PRIMARY KEY,
        report_type TEXT NOT NULL,
        site_url    TEXT,
        params      JSONB,
        duration_ms INTEGER,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
    await p.query(`
      CREATE INDEX IF NOT EXISTS reports_log_created_at_idx
      ON reports_log (created_at DESC);
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS sites_seen (
        site_url    TEXT PRIMARY KEY,
        first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
        report_count INTEGER NOT NULL DEFAULT 0
      );
    `);
    await p.query(`
      CREATE TABLE IF NOT EXISTS keywords_tracked (
        id          BIGSERIAL PRIMARY KEY,
        site_url    TEXT NOT NULL,
        query       TEXT NOT NULL,
        first_seen  TIMESTAMPTZ NOT NULL DEFAULT now(),
        last_seen   TIMESTAMPTZ NOT NULL DEFAULT now(),
        UNIQUE (site_url, query)
      );
    `);
    dbReady = true;
    console.log('[db] migrations OK');
  } catch (err) {
    dbError = err.message;
    console.error('[db] migration failed:', err.message);
  }
}

// Log a successful report request. Fire-and-forget — never blocks the response.
export function logReport({ reportType, siteUrl, params, durationMs }) {
  const p = getPool();
  if (!p) return;
  p.query(
    `INSERT INTO reports_log (report_type, site_url, params, duration_ms)
     VALUES ($1, $2, $3::jsonb, $4)`,
    [reportType, siteUrl || null, JSON.stringify(params || {}), durationMs || null]
  ).catch((err) => console.error('[db] logReport failed:', err.message));

  if (siteUrl) {
    p.query(
      `INSERT INTO sites_seen (site_url, last_seen, report_count)
       VALUES ($1, now(), 1)
       ON CONFLICT (site_url) DO UPDATE
         SET last_seen = now(),
             report_count = sites_seen.report_count + 1`,
      [siteUrl]
    ).catch((err) => console.error('[db] sites_seen upsert failed:', err.message));
  }
}

// Log keywords seen in a report (call from inside top-queries / content-gaps handlers).
// Bulk upsert. Fire-and-forget.
export function logKeywords(siteUrl, queries) {
  const p = getPool();
  if (!p || !siteUrl || !Array.isArray(queries) || queries.length === 0) return;
  // Cap at 100 per call to keep payload small
  const clean = queries.filter(Boolean).slice(0, 100);
  if (clean.length === 0) return;
  // Build a multi-row INSERT ... ON CONFLICT
  const values = clean.map((_, i) => `($1, $${i + 2}, now())`).join(', ');
  const params = [siteUrl, ...clean];
  p.query(
    `INSERT INTO keywords_tracked (site_url, query, last_seen)
     VALUES ${values}
     ON CONFLICT (site_url, query) DO UPDATE SET last_seen = now()`,
    params
  ).catch((err) => console.error('[db] logKeywords failed:', err.message));
}

// ─── Read helpers (used by Hub connector) ──────────────────────────────────

export async function getMetrics() {
  const p = getPool();
  if (!p) {
    return {
      sites_connected: 0,
      reports_generated: 0,
      reports_last_7d: 0,
      keywords_tracked: 0,
      database: 'not_connected',
    };
  }
  try {
    const [sites, reports, reports7d, keywords] = await Promise.all([
      p.query('SELECT COUNT(*)::int AS n FROM sites_seen'),
      p.query('SELECT COUNT(*)::int AS n FROM reports_log'),
      p.query(`SELECT COUNT(*)::int AS n FROM reports_log
               WHERE created_at >= now() - INTERVAL '7 days'`),
      p.query('SELECT COUNT(*)::int AS n FROM keywords_tracked'),
    ]);
    return {
      sites_connected: sites.rows[0].n,
      reports_generated: reports.rows[0].n,
      reports_last_7d: reports7d.rows[0].n,
      keywords_tracked: keywords.rows[0].n,
      database: 'connected',
    };
  } catch (err) {
    console.error('[db] getMetrics failed:', err.message);
    return {
      sites_connected: 0,
      reports_generated: 0,
      reports_last_7d: 0,
      keywords_tracked: 0,
      database: 'error',
      error: err.message,
    };
  }
}

export async function getRecentReports(limit = 5) {
  const p = getPool();
  if (!p) return [];
  try {
    const r = await p.query(
      `SELECT id, report_type, site_url, duration_ms, created_at
         FROM reports_log
         ORDER BY created_at DESC
         LIMIT $1`,
      [Math.min(Math.max(parseInt(limit, 10) || 5, 1), 50)]
    );
    return r.rows.map((row) => ({
      id: String(row.id),
      type: 'report',
      label: row.report_type,
      site: row.site_url,
      durationMs: row.duration_ms,
      timestamp: row.created_at,
    }));
  } catch (err) {
    console.error('[db] getRecentReports failed:', err.message);
    return [];
  }
}

export function getDbStatus() {
  return {
    configured: !!process.env.DATABASE_URL,
    ready: dbReady,
    error: dbError,
  };
}
