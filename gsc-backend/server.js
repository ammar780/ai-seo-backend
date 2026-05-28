// server.js
// Backend API only (no static file serving). Frontend deployed separately.
//
// Public routes (no auth):
//   GET  /api/health
//   GET  /api/auth/callback   (Google needs to hit this without basic auth)
//
// Protected routes (basic auth + optional X-API-Key):
//   GET  /api/config
//   GET  /api/auth/status
//   GET  /api/auth/url
//   GET  /api/sites
//   GET  /api/reports/:type
//   POST /api/ai/summarize
//   POST /api/ai/title-rewrites
//   POST /api/ai/diagnose
//   POST /api/ai/cluster
//   POST /api/ai/chat

import 'dotenv/config';
import express from 'express';
import cors from 'cors';

import { buildAuthUrl, handleCallback, isAuthorized, getAuthorizedClient } from './src/auth.js';
import { GSCClient } from './src/gsc-client.js';

import { overview } from './src/reports/overview.js';
import { topQueries } from './src/reports/top-queries.js';
import { topPages } from './src/reports/top-pages.js';
import { devices } from './src/reports/devices.js';
import { countries } from './src/reports/countries.js';
import { ctrOpportunities } from './src/reports/ctr-opportunities.js';
import { yearOverYear } from './src/reports/year-over-year.js';
import { winnersLosers } from './src/reports/winners-losers.js';
import { rankingHeatmap } from './src/reports/ranking-heatmap.js';
import { contentGaps } from './src/reports/content-gaps.js';

import {
  isAIConfigured, summarizeReport, rewriteTitles,
  diagnoseDrops, clusterQueries, chat,
} from './src/ai/openai-client.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ───────────────────────────────────────────────────────────────────
// Allow the deployed frontend + local dev (Vite on 5173).

const allowedOrigins = [
  process.env.FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:4173', // vite preview
].filter(Boolean);

app.use(cors({
  origin: (origin, cb) => {
    // Allow requests with no origin (e.g. curl, server-to-server)
    if (!origin) return cb(null, true);
    if (allowedOrigins.includes(origin)) return cb(null, true);
    return cb(new Error(`CORS: ${origin} not allowed`));
  },
  credentials: true,
  exposedHeaders: ['Content-Length'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
}));

app.use(express.json({ limit: '2mb' }));

// ─── Health (public) ────────────────────────────────────────────────────────

app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    authorized: isAuthorized(),
    mock: process.env.MOCK_GSC === 'true',
    siteConfigured: Boolean(process.env.GSC_SITE_URL),
    aiConfigured: isAIConfigured(),
  });
});

// ─── Auth gates ─────────────────────────────────────────────────────────────

app.use((req, res, next) => {
  // OAuth callback must bypass auth (Google hits it without credentials)
  if (req.path === '/api/auth/callback') return next();
  if (req.path === '/api/health') return next();

  // X-API-Key header check (if configured)
  if (process.env.API_KEY) {
    const provided = req.headers['x-api-key'];
    if (provided !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Invalid or missing X-API-Key header' });
    }
  }

  // Basic auth (if configured)
  if (process.env.APP_PASSWORD) {
    const header = req.headers.authorization || '';
    const [scheme, encoded] = header.split(' ');
    if (scheme === 'Basic' && encoded) {
      const [user, pass] = Buffer.from(encoded, 'base64').toString('utf-8').split(':');
      if (user === 'admin' && pass === process.env.APP_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="GSC SEO Reporter"');
    return res.status(401).json({ error: 'Authentication required' });
  }

  return next();
});

// ─── Config + auth status ───────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json({
    siteUrl: process.env.GSC_SITE_URL || null,
    mock: process.env.MOCK_GSC === 'true',
    passwordProtected: Boolean(process.env.APP_PASSWORD),
    aiConfigured: isAIConfigured(),
  });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authorized: isAuthorized() });
});

app.get('/api/auth/url', (req, res) => {
  try { res.json({ url: buildAuthUrl() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Google redirects here. After exchanging the code, redirect to the FRONTEND.
app.get('/api/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  const frontend = (process.env.FRONTEND_URL || '').replace(/\/$/, '');
  if (error) return res.redirect(`${frontend}/?auth_error=${encodeURIComponent(error)}`);
  if (!code) return res.redirect(`${frontend}/?auth_error=missing_code`);
  try {
    const tokens = await handleCallback(code);
    const refreshToken = tokens.refresh_token || '';
    res.redirect(`${frontend}/auth-success#token=${encodeURIComponent(refreshToken)}`);
  } catch (err) {
    res.redirect(`${frontend}/?auth_error=${encodeURIComponent(err.message)}`);
  }
});

// ─── Sites ──────────────────────────────────────────────────────────────────

app.get('/api/sites', async (req, res) => {
  try {
    if (!isAuthorized()) return res.status(401).json({ error: 'Not authorized' });
    const gsc = new GSCClient(process.env.MOCK_GSC === 'true' ? null : getAuthorizedClient(), process.env.GSC_SITE_URL);
    const sites = await gsc.listSites();
    res.json({ sites });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Report dispatcher ──────────────────────────────────────────────────────

const REPORTS = {
  'overview': (opts) => overview(makeGsc(), parseDays(opts)),
  'top-queries': (opts) => topQueries(makeGsc(), { ...parseDays(opts), limit: int(opts.limit, 50), brand: opts.brand || null }),
  'top-pages': (opts) => topPages(makeGsc(), { ...parseDays(opts), limit: int(opts.limit, 50) }),
  'devices': (opts) => devices(makeGsc(), parseDays(opts)),
  'countries': (opts) => countries(makeGsc(), { ...parseDays(opts), limit: int(opts.limit, 25) }),
  'ctr-opportunities': (opts) => ctrOpportunities(makeGsc(), {
    ...parseDays(opts), minImpressions: int(opts.minImpressions, 200), maxPosition: int(opts.maxPosition, 10),
  }),
  'year-over-year': (opts) => yearOverYear(makeGsc(), parseDays(opts)),
  'winners-losers': (opts) => winnersLosers(makeGsc(), { ...parseDays(opts), limit: int(opts.limit, 25) }),
  'ranking-heatmap': (opts) => rankingHeatmap(makeGsc(), { months: int(opts.months, 6), topQueries: int(opts.topQueries, 20) }),
  'content-gaps': (opts) => contentGaps(makeGsc(), { ...parseDays(opts), minImpressions: int(opts.minImpressions, 500), minPosition: int(opts.minPosition, 8) }),
};

app.get('/api/reports/:type', async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) return res.status(404).json({ error: `Unknown report: ${req.params.type}` });
  if (!isAuthorized()) return res.status(401).json({ error: 'Not authorized' });
  if (!process.env.GSC_SITE_URL) return res.status(500).json({ error: 'GSC_SITE_URL not set' });
  try {
    const report = await fn(req.query);
    res.json(report);
  } catch (err) {
    console.error(`Report '${req.params.type}' failed:`, err);
    res.status(500).json({ error: err.message });
  }
});

// ─── AI routes ──────────────────────────────────────────────────────────────

function aiGuard(req, res, next) {
  if (!isAIConfigured()) {
    return res.status(503).json({ error: 'OPENAI_API_KEY not configured on backend' });
  }
  next();
}

app.post('/api/ai/summarize', aiGuard, async (req, res) => {
  try {
    const { report } = req.body;
    if (!report) return res.status(400).json({ error: 'Missing report body' });
    const result = await summarizeReport(report);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/title-rewrites', aiGuard, async (req, res) => {
  try {
    const { opportunities, siteContext } = req.body;
    if (!opportunities || !Array.isArray(opportunities)) return res.status(400).json({ error: 'Missing opportunities array' });
    const result = await rewriteTitles(opportunities, siteContext);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/diagnose', aiGuard, async (req, res) => {
  try {
    const { losers } = req.body;
    if (!losers) return res.status(400).json({ error: 'Missing losers body' });
    const result = await diagnoseDrops(losers);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/cluster', aiGuard, async (req, res) => {
  try {
    const { gaps, siteContext } = req.body;
    if (!gaps || !Array.isArray(gaps)) return res.status(400).json({ error: 'Missing gaps array' });
    const result = await clusterQueries(gaps, siteContext);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

app.post('/api/ai/chat', aiGuard, async (req, res) => {
  try {
    const { question, report } = req.body;
    if (!question) return res.status(400).json({ error: 'Missing question' });
    const result = await chat(question, report);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ─── Helpers ────────────────────────────────────────────────────────────────

function makeGsc() {
  const auth = process.env.MOCK_GSC === 'true' ? null : getAuthorizedClient();
  return new GSCClient(auth, process.env.GSC_SITE_URL);
}
function parseDays(opts) { return { days: int(opts.days, 28) }; }
function int(v, dflt) { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : dflt; }

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n  ┌──────────────────────────────────────────────────────┐`);
  console.log(`  │  GSC SEO Reporter API on :${PORT}${' '.repeat(Math.max(0, 26 - String(PORT).length))}│`);
  console.log(`  │  Site:       ${(process.env.GSC_SITE_URL || 'NOT SET').padEnd(39)}│`);
  console.log(`  │  Frontend:   ${(process.env.FRONTEND_URL || 'NOT SET').padEnd(39)}│`);
  console.log(`  │  Authorized: ${(isAuthorized() ? 'yes ✓' : 'no — visit /api/auth/url').padEnd(39)}│`);
  console.log(`  │  AI:         ${(isAIConfigured() ? `enabled (${process.env.OPENAI_MODEL || 'gpt-4o-mini'})` : 'DISABLED — no OPENAI_API_KEY').padEnd(39)}│`);
  console.log(`  │  Mock mode:  ${(process.env.MOCK_GSC === 'true' ? 'ENABLED' : 'disabled').padEnd(39)}│`);
  console.log(`  │  Password:   ${(process.env.APP_PASSWORD ? 'enabled (user: admin)' : 'NONE — open access').padEnd(39)}│`);
  console.log(`  └──────────────────────────────────────────────────────┘\n`);
});
