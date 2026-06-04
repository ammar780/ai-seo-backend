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
import { aiOverviewImpact } from './src/reports/ai-overview-impact.js';

import {
  isAIConfigured, summarizeReport, rewriteTitles,
  diagnoseDrops, clusterQueries, chat, aioStrategy, testApiKey,
} from './src/ai/openai-client.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ───────────────────────────────────────────────────────────────────
// Defensive: normalize URLs, NEVER throw on mismatch (throws crash the request
// and flood logs), accept Railway domains by default if FRONTEND_URL unset.
// Real auth is APP_PASSWORD basic auth — CORS is just browser-side noise.

function normalize(url) {
  if (!url) return null;
  return String(url).trim().replace(/\/+$/, '').toLowerCase();
}

const FRONTEND_URL = normalize(process.env.FRONTEND_URL);
const allowedOrigins = new Set([
  FRONTEND_URL,
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:3000',
].filter(Boolean));

function isOriginAllowed(originRaw) {
  if (!originRaw) return true; // server-to-server, curl, same-origin
  const origin = normalize(originRaw);
  if (allowedOrigins.has(origin)) return true;
  // Permissive fallback: allow ANY *.up.railway.app subdomain.
  // (The backend is YOUR backend — basic auth is the real lock.)
  if (/^https:\/\/[a-z0-9-]+\.up\.railway\.app$/i.test(origin)) return true;
  // If FRONTEND_URL was not configured, allow all origins with a console warning.
  if (!FRONTEND_URL) {
    console.warn(`[CORS] FRONTEND_URL not set — allowing origin ${origin}. Set FRONTEND_URL on this service to restrict.`);
    return true;
  }
  return false;
}

app.use(cors({
  origin: (origin, cb) => {
    if (isOriginAllowed(origin)) return cb(null, true);
    // CRITICAL: do not throw. Throws crash the request and flood logs.
    // Returning cb(null, false) sends a clean response with no CORS headers,
    // which the browser will block — same effect, no log spam.
    console.warn(`[CORS] Blocked origin: ${origin}`);
    return cb(null, false);
  },
  credentials: true,
  exposedHeaders: ['Content-Length'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key'],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  maxAge: 86400,
}));

// Explicit OPTIONS handler — some clients need this for preflight
app.options('*', cors());

app.use(express.json({ limit: '2mb' }));

// Root — friendly response so visiting the bare backend URL isn't confusing.
app.get('/', (req, res) => {
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>GSC SEO Reporter API</title>
<style>body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0b;color:#f5f5f7;max-width:640px;margin:48px auto;padding:24px;line-height:1.6;}
h1{font-weight:400;font-size:32px;margin:0 0 8px;}a{color:#f1c349;}code{background:#131316;padding:2px 8px;border-radius:4px;color:#f1c349;font-family:Menlo,monospace;font-size:13px;}</style>
</head><body>
<h1>GSC SEO Reporter — Backend API</h1>
<p style="color:#9999a3">This is the backend service. The UI is at your <strong>frontend</strong> Railway URL.</p>
<p>Useful endpoints:</p>
<ul>
  <li><a href="/api/health">/api/health</a> — service health</li>
  <li><a href="/api/diag">/api/diag</a> — full diagnostic (env var status, OAuth redirect URI, etc.)</li>
</ul>
</body></html>`);
});

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

// ─── Public diagnostic — exposes env var STATUS (not values) ─────────────────
// Visit /api/diag in browser to debug "why is my deploy broken?" without auth.

app.get('/api/diag', (req, res) => {
  const set = (v) => Boolean(v && String(v).trim());
  const APP_URL = normalize(process.env.APP_URL);
  res.json({
    backend: {
      url: APP_URL || null,
      requestOrigin: req.headers.origin || null,
      requestHost: req.headers.host || null,
    },
    env: {
      GOOGLE_CLIENT_ID:     set(process.env.GOOGLE_CLIENT_ID) ? 'set' : 'MISSING',
      GOOGLE_CLIENT_SECRET: set(process.env.GOOGLE_CLIENT_SECRET) ? 'set' : 'MISSING',
      APP_URL:              APP_URL || 'MISSING',
      GSC_SITE_URL:         process.env.GSC_SITE_URL || 'MISSING',
      FRONTEND_URL:         FRONTEND_URL || 'MISSING (CORS will be permissive)',
      OPENAI_API_KEY:       set(process.env.OPENAI_API_KEY) ? 'set' : 'MISSING',
      OPENAI_MODEL:         process.env.OPENAI_MODEL || 'gpt-4o-mini (default)',
      SITE_DESCRIPTION:     set(process.env.SITE_DESCRIPTION) ? `set (${process.env.SITE_DESCRIPTION.slice(0, 60)}${process.env.SITE_DESCRIPTION.length > 60 ? '...' : ''})` : 'not set (AI will have less context)',
      APP_PASSWORD:         set(process.env.APP_PASSWORD) ? 'set (admin / ****)' : 'MISSING (open access)',
      API_KEY:              set(process.env.API_KEY) ? 'set' : 'not set (optional)',
      GOOGLE_REFRESH_TOKEN: set(process.env.GOOGLE_REFRESH_TOKEN) ? 'set' : 'not set (do OAuth first)',
      MOCK_GSC:             process.env.MOCK_GSC === 'true' ? 'true (using fake data)' : 'false',
    },
    oauth: {
      expectedRedirectUri: APP_URL ? `${APP_URL}/api/auth/callback` : 'cannot compute — APP_URL not set',
      hint: 'This EXACT URL must be added in Google Cloud → Credentials → OAuth Client → Authorized redirect URIs',
    },
    cors: {
      allowedOrigins: [...allowedOrigins],
      permissiveFallback: !FRONTEND_URL,
      note: 'Railway *.up.railway.app subdomains are always allowed.',
    },
    status: computeStatus(),
  });
});

function computeStatus() {
  const issues = [];
  if (!process.env.GOOGLE_CLIENT_ID)     issues.push('Set GOOGLE_CLIENT_ID');
  if (!process.env.GOOGLE_CLIENT_SECRET) issues.push('Set GOOGLE_CLIENT_SECRET');
  if (!process.env.APP_URL)              issues.push('Set APP_URL to this backend\'s Railway URL');
  if (!process.env.GSC_SITE_URL)         issues.push('Set GSC_SITE_URL (e.g. sc-domain:yoursite.com)');
  if (!process.env.FRONTEND_URL)         issues.push('Set FRONTEND_URL to your frontend Railway URL (for CORS — optional but recommended)');
  if (!process.env.OPENAI_API_KEY)       issues.push('Set OPENAI_API_KEY to enable AI features');
  if (!process.env.GOOGLE_REFRESH_TOKEN && !isAuthorized()) issues.push('Complete OAuth flow and add GOOGLE_REFRESH_TOKEN');
  return issues.length === 0 ? 'READY ✓' : issues;
}

// ─── Auth gates ─────────────────────────────────────────────────────────────

// ─── Session token auth ─────────────────────────────────────────────────────
// Replaces HTTP Basic Auth (which doesn't survive cross-origin requests in
// browsers and triggers the login popup repeatedly).
//
// Flow:
//   1. Frontend POSTs to /api/login with the password
//   2. Backend returns a session token (HMAC-signed, stateless)
//   3. Frontend stores token in localStorage and sends it as
//      Authorization: Bearer <token> on every request
//   4. Tokens are valid for 30 days. Refreshed automatically on each request.

import crypto from 'node:crypto';

const SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const SESSION_SECRET = process.env.SESSION_SECRET ||
  (process.env.APP_PASSWORD ? crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest('hex') : '');

function signToken(payload) {
  const data = JSON.stringify(payload);
  const b64 = Buffer.from(data).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  if (sig.length !== expected.length) return null;
  if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// POST /api/login { password } → { token } (or 401)
app.post('/api/login', (req, res) => {
  if (!process.env.APP_PASSWORD) {
    // No password set → no auth required → return a permanent token
    return res.json({ token: signToken({ exp: Date.now() + SESSION_DURATION_MS, sub: 'no-auth' }) });
  }
  const { password } = req.body || {};
  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Incorrect password' });
  }
  const token = signToken({ exp: Date.now() + SESSION_DURATION_MS, sub: 'admin' });
  res.json({ token });
});

// GET /api/login/verify → { valid: true/false }
// Lets the frontend check whether the stored token still works on page load.
app.get('/api/login/verify', (req, res) => {
  if (!process.env.APP_PASSWORD) return res.json({ valid: true, authRequired: false });
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
  res.json({ valid: Boolean(verifyToken(token)), authRequired: true });
});

app.use((req, res, next) => {
  // Always-public endpoints — Google, Railway health checks, login itself
  if (req.path === '/api/auth/callback') return next();
  if (req.path === '/api/health') return next();
  if (req.path === '/api/diag') return next();
  if (req.path === '/api/login') return next();
  if (req.path === '/api/login/verify') return next();

  // X-API-Key header check (if configured) — optional second layer
  if (process.env.API_KEY) {
    const provided = req.headers['x-api-key'];
    if (provided !== process.env.API_KEY) {
      return res.status(401).json({ error: 'Invalid or missing X-API-Key header' });
    }
  }

  // Session token auth (replaces basic auth)
  if (process.env.APP_PASSWORD) {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    const payload = verifyToken(token);
    if (!payload) {
      return res.status(401).json({ error: 'Session expired. Please log in again.', code: 'auth_required' });
    }
  }

  return next();
});

// ─── Config + auth status ───────────────────────────────────────────────────

app.get('/api/config', (req, res) => {
  res.json({
    siteUrl: process.env.GSC_SITE_URL || null,
    siteDescription: process.env.SITE_DESCRIPTION || null,
    mock: process.env.MOCK_GSC === 'true',
    passwordProtected: Boolean(process.env.APP_PASSWORD),
    aiConfigured: isAIConfigured(),
    aiModel: process.env.OPENAI_MODEL || 'gpt-4o-mini',
  });
});

app.get('/api/auth/status', (req, res) => {
  res.json({ authorized: isAuthorized() });
});

app.get('/api/auth/url', (req, res) => {
  if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET) {
    return res.status(400).json({
      error: 'Google OAuth not configured',
      detail: 'Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET on the backend Railway service. See /api/diag for current status.',
    });
  }
  if (!process.env.APP_URL) {
    return res.status(400).json({
      error: 'APP_URL not configured',
      detail: 'Set APP_URL to this backend\'s Railway URL (no trailing slash). See /api/diag.',
    });
  }
  try { res.json({ url: buildAuthUrl() }); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

// Google redirects here. ALWAYS render a confirmation page directly from the
// backend showing the refresh token. This is the most critical moment of the
// setup — we don't risk losing it to a frontend redirect that might fail.
app.get('/api/auth/callback', async (req, res) => {
  const { code, error } = req.query;
  const frontend = FRONTEND_URL;

  if (error) {
    return res.status(400).send(errorHtml('OAuth was cancelled or denied', String(error)));
  }
  if (!code) {
    return res.status(400).send(errorHtml('Missing authorization code', 'Google did not return a code parameter.'));
  }

  try {
    const tokens = await handleCallback(code);
    const refreshToken = tokens.refresh_token || '';
    return res.status(200).send(tokenHtml(refreshToken, frontend));
  } catch (err) {
    return res.status(500).send(errorHtml('Token exchange failed', err.message));
  }
});

function tokenHtml(token, frontendUrl) {
  const safeFrontend = frontendUrl ? frontendUrl.replace(/"/g, '') : '';
  return `<!doctype html><html><head><meta charset="utf-8"><title>Authorized — Save Your Refresh Token</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,system-ui,sans-serif;background:#0a0a0b;color:#f5f5f7;max-width:760px;margin:48px auto;padding:24px;line-height:1.6;}
  h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:42px;margin:0 0 12px;letter-spacing:-0.02em;}
  .ok{color:#34d399;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-bottom:16px;font-weight:500;}
  .panel{background:#131316;border:1px solid #26262d;border-radius:14px;padding:28px;margin:24px 0;}
  .label{font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#f1c349;margin-bottom:14px;font-weight:600;}
  .token{display:block;background:#000;border:1px solid #26262d;border-radius:8px;padding:18px;font-family:'JetBrains Mono',Menlo,monospace;font-size:12px;word-break:break-all;color:#f1c349;margin:14px 0;user-select:all;line-height:1.5;}
  ol{padding-left:20px;color:#9999a3;line-height:1.9;}
  ol li{margin:6px 0;}
  ol strong{color:#f5f5f7;}
  code{background:#1a1a1f;padding:3px 9px;border-radius:4px;color:#f1c349;font-family:'JetBrains Mono',Menlo,monospace;font-size:13px;}
  button,.btn{background:#f1c349;color:#0a0a0b;border:none;padding:12px 22px;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;text-decoration:none;display:inline-flex;align-items:center;gap:8px;transition:background .15s;}
  button:hover,.btn:hover{background:#ffd75e;}
  .btn-2{background:#131316;color:#f5f5f7;border:1px solid #26262d;}
  .btn-2:hover{background:#1a1a1f;}
  .row{display:flex;gap:12px;margin-top:16px;flex-wrap:wrap;}
  .pulse{display:inline-block;width:8px;height:8px;background:#34d399;border-radius:50%;animation:pulse 1.5s infinite;}
  @keyframes pulse{0%,100%{opacity:1}50%{opacity:.4}}
  .important{background:rgba(241,195,73,.08);border:1px solid #f1c349;border-radius:10px;padding:18px 22px;color:#f1c349;font-size:14px;margin:24px 0;}
  .important strong{color:#ffd75e;}
</style></head><body>
<div class="ok"><span class="pulse"></span> AUTHORIZED · GOOGLE SEARCH CONSOLE</div>
<h1>Save your refresh token.</h1>
<p style="color:#9999a3;font-size:16px;margin:0 0 8px;">Google Search Console authorized successfully. Now save the refresh token below as a Railway environment variable so this works permanently.</p>

<div class="important">
  ⚠ <strong>Do this NOW</strong> — if you close this page without copying the token, you'll have to redo the OAuth flow.
</div>

<div class="panel">
  <div class="label">YOUR REFRESH TOKEN</div>
  <code class="token" id="tok">${token || '(no token returned — try clicking Authorize again from the dashboard)'}</code>
  <div class="row">
    <button onclick="navigator.clipboard.writeText(document.getElementById('tok').innerText);this.innerHTML='✓ Copied — now paste it into Railway'">📋 Copy token</button>
  </div>
</div>

<h2 style="font-family:'Instrument Serif',serif;font-weight:400;font-size:28px;margin:32px 0 12px;">Next 3 steps:</h2>
<ol>
  <li><strong>Open Railway</strong> → your <strong>backend</strong> service → <strong>Variables</strong> tab</li>
  <li>Click <strong>+ New Variable</strong>. Name: <code>GOOGLE_REFRESH_TOKEN</code>. Value: paste the token above.</li>
  <li>Railway auto-redeploys (~60 sec). Auth now persists forever.</li>
</ol>

${safeFrontend ? `<div class="row" style="margin-top:32px;">
  <a class="btn btn-2" href="${safeFrontend}">← Back to dashboard</a>
</div>` : ''}

<p style="font-size:12px;color:#5f5f6b;margin-top:48px;">
  This page is served directly from your backend at <code>/api/auth/callback</code>. It works regardless of frontend login state.
</p>
</body></html>`;
}

function errorHtml(title, detail) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${title}</title>
<style>
  body{font-family:-apple-system,system-ui,sans-serif;background:#0a0a0b;color:#f5f5f7;max-width:640px;margin:48px auto;padding:24px;line-height:1.6;}
  h1{font-family:'Instrument Serif',Georgia,serif;font-weight:400;font-size:32px;margin:0 0 12px;color:#f87171;}
  pre{background:#131316;border:1px solid #26262d;padding:14px;border-radius:8px;color:#9999a3;font-family:'JetBrains Mono',Menlo,monospace;font-size:13px;overflow-x:auto;}
  a{color:#f1c349;}
</style></head><body>
<h1>${title}</h1>
<pre>${detail}</pre>
<p>Visit <a href="/api/diag">/api/diag</a> to check backend configuration.</p>
</body></html>`;
}

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
  'content-gaps': (opts) => contentGaps(makeGsc(), {
    ...parseDays(opts),
    minImpressions: int(opts.minImpressions, 300),
    minPosition: int(opts.minPosition, 11),
    maxPosition: int(opts.maxPosition, 50),
  }),
  'ai-overview-impact': (opts) => aiOverviewImpact(makeGsc(), {
    ...parseDays(opts),
    minImpressions: int(opts.minImpressions, 300),
  }),
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

app.post('/api/ai/aio-strategy', aiGuard, async (req, res) => {
  try {
    const { cannibalized, siteContext } = req.body;
    if (!cannibalized || !Array.isArray(cannibalized)) return res.status(400).json({ error: 'Missing cannibalized array' });
    const result = await aioStrategy(cannibalized, siteContext);
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Tests the OPENAI_API_KEY with a tiny real call. Useful for debugging.
app.get('/api/ai/test', aiGuard, async (req, res) => {
  const result = await testApiKey();
  res.status(result.ok ? 200 : 500).json(result);
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
  const status = computeStatus();
  const isReady = status === 'READY ✓';
  console.log(`\n  ┌────────────────────────────────────────────────────────────┐`);
  console.log(`  │  GSC SEO Reporter API on :${PORT}${' '.repeat(Math.max(0, 32 - String(PORT).length))}│`);
  console.log(`  ├────────────────────────────────────────────────────────────┤`);
  console.log(`  │  Site:       ${(process.env.GSC_SITE_URL || '⚠ NOT SET').padEnd(45)}│`);
  console.log(`  │  Frontend:   ${(FRONTEND_URL || '⚠ NOT SET (CORS will be permissive)').padEnd(45)}│`);
  console.log(`  │  APP_URL:    ${(normalize(process.env.APP_URL) || '⚠ NOT SET (OAuth will fail)').padEnd(45)}│`);
  console.log(`  │  Authorized: ${(isAuthorized() ? 'yes ✓' : '✗ no — complete OAuth flow').padEnd(45)}│`);
  console.log(`  │  AI:         ${(isAIConfigured() ? `enabled (${process.env.OPENAI_MODEL || 'gpt-4o-mini'})` : '⚠ DISABLED — no OPENAI_API_KEY').padEnd(45)}│`);
  console.log(`  │  Mock mode:  ${(process.env.MOCK_GSC === 'true' ? 'ENABLED (fake data)' : 'disabled').padEnd(45)}│`);
  console.log(`  │  Password:   ${(process.env.APP_PASSWORD ? 'enabled (user: admin)' : '⚠ NONE — open access').padEnd(45)}│`);
  console.log(`  ├────────────────────────────────────────────────────────────┤`);
  if (isReady) {
    console.log(`  │  STATUS:     READY ✓ — visit your frontend to use the app  │`);
  } else {
    console.log(`  │  STATUS:     NEEDS CONFIG — fix the issues below           │`);
    for (const issue of status) {
      const lines = issue.match(/.{1,56}/g) || [issue];
      for (const line of lines) {
        console.log(`  │    • ${line.padEnd(54)}│`);
      }
    }
  }
  console.log(`  ├────────────────────────────────────────────────────────────┤`);
  console.log(`  │  Diagnostic: visit /api/diag in your browser               │`);
  console.log(`  └────────────────────────────────────────────────────────────┘\n`);
});
