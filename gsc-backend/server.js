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
import { boundedInt, BOUNDS, ALGORITHM_UPDATES } from './src/seo-constants.js';
import { reportToCSV } from './src/csv-export.js';
import { migrate, logReport, logKeywords, getMetrics, getRecentReports, getDbStatus } from './src/db.js';

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
import { siteHealth } from './src/reports/site-health.js';

import {
  isAIConfigured, summarizeReport, rewriteTitles,
  diagnoseDrops, clusterQueries, chat, aioStrategy, testApiKey,
  discoverKeywords, generateBrief,
} from './src/ai/openai-client.js';

const app = express();
const PORT = process.env.PORT || 3001;

// ─── CORS ───────────────────────────────────────────────────────────────────
// Defensive: normalize URLs, NEVER throw on mismatch (throws crash the request
// and flood logs). Only allow EXACT origin matches (no wildcards) when
// FRONTEND_URL is set — this is the security-correct default. When unset,
// we permit any origin with a warning (developer convenience only).

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
  // If FRONTEND_URL not configured, fall back to permissive with warning.
  if (!FRONTEND_URL) {
    console.warn(`[CORS] FRONTEND_URL not set — allowing origin ${origin}. Set FRONTEND_URL to restrict.`);
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
  // Format checks catch the common "I pasted it wrong" mistakes that cause
  // Google's invalid_client error.
  const gci = (process.env.GOOGLE_CLIENT_ID || '').trim();
  const gcs = (process.env.GOOGLE_CLIENT_SECRET || '').trim();

  if (!gci)                                         issues.push('Set GOOGLE_CLIENT_ID');
  else if (!gci.endsWith('.apps.googleusercontent.com'))
                                                    issues.push(`GOOGLE_CLIENT_ID looks malformed — should end with ".apps.googleusercontent.com" (got "${gci.slice(0, 20)}...${gci.slice(-30)}")`);
  else if (gci !== process.env.GOOGLE_CLIENT_ID)    issues.push('GOOGLE_CLIENT_ID has leading or trailing whitespace — re-paste it');

  if (!gcs)                                         issues.push('Set GOOGLE_CLIENT_SECRET');
  else if (!gcs.startsWith('GOCSPX-'))              issues.push('GOOGLE_CLIENT_SECRET looks malformed — should start with "GOCSPX-"');
  else if (gcs !== process.env.GOOGLE_CLIENT_SECRET) issues.push('GOOGLE_CLIENT_SECRET has leading or trailing whitespace — re-paste it');

  if (!process.env.APP_URL)              issues.push("Set APP_URL to this backend's Railway URL");
  if (!process.env.GSC_SITE_URL)         issues.push('Set GSC_SITE_URL (e.g. sc-domain:yoursite.com)');
  if (!process.env.FRONTEND_URL)         issues.push('Set FRONTEND_URL to your frontend Railway URL (for CORS — recommended)');
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

// SESSION_SECRET resolution:
// 1. Explicit SESSION_SECRET env var (best — rotate without affecting password)
// 2. Hash of APP_PASSWORD (backward-compatible — secret rotates with password)
// 3. If neither, sessions are DISABLED — we throw on any signing attempt rather
//    than silently using empty string (which would make tokens forgeable).
const SESSION_SECRET = (() => {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  if (process.env.APP_PASSWORD) {
    return crypto.createHash('sha256').update(process.env.APP_PASSWORD).digest('hex');
  }
  return null; // signals "auth disabled"
})();

function signToken(payload) {
  if (!SESSION_SECRET) throw new Error('Session signing impossible — no secret configured');
  const data = JSON.stringify(payload);
  const b64 = Buffer.from(data).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  return `${b64}.${sig}`;
}

function verifyToken(token) {
  if (!SESSION_SECRET) return null;
  if (!token || typeof token !== 'string') return null;
  const [b64, sig] = token.split('.');
  if (!b64 || !sig) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(b64).digest('base64url');
  if (sig.length !== expected.length) return null;
  try {
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  } catch { return null; }
  try {
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString('utf-8'));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// Constant-time string comparison to prevent timing attacks on password.
function constantTimeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const aBuf = Buffer.from(a, 'utf-8');
  const bBuf = Buffer.from(b, 'utf-8');
  if (aBuf.length !== bBuf.length) {
    // Still do a comparison to mitigate length-based timing leak.
    crypto.timingSafeEqual(aBuf, aBuf);
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

// ─── Login rate limiter ─────────────────────────────────────────────────────
// In-memory token bucket per IP. Prevents brute-force on /api/login.
const LOGIN_ATTEMPTS = new Map(); // ip → { count, resetAt }
const LOGIN_MAX_ATTEMPTS = 10;
const LOGIN_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
const LOGIN_LOCKOUT_MS = 30 * 60 * 1000; // 30 minutes after exceeding limit

function checkLoginRateLimit(ip) {
  const now = Date.now();
  const entry = LOGIN_ATTEMPTS.get(ip);
  if (!entry || entry.resetAt < now) {
    LOGIN_ATTEMPTS.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS - 1 };
  }
  if (entry.count >= LOGIN_MAX_ATTEMPTS) {
    if (!entry.lockedUntil) entry.lockedUntil = now + LOGIN_LOCKOUT_MS;
    if (now < entry.lockedUntil) {
      return { allowed: false, retryAfter: Math.ceil((entry.lockedUntil - now) / 1000) };
    }
    // Lockout expired — reset
    LOGIN_ATTEMPTS.set(ip, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS - 1 };
  }
  entry.count++;
  return { allowed: true, remaining: LOGIN_MAX_ATTEMPTS - entry.count };
}

// Clear old entries every 5 minutes to prevent memory growth.
setInterval(() => {
  const now = Date.now();
  for (const [ip, entry] of LOGIN_ATTEMPTS) {
    if ((entry.lockedUntil || entry.resetAt) < now) LOGIN_ATTEMPTS.delete(ip);
  }
}, 5 * 60 * 1000).unref();

// POST /api/login { password } → { token } (or 401, or 429)
app.post('/api/login', (req, res) => {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';
  const rateCheck = checkLoginRateLimit(ip);
  if (!rateCheck.allowed) {
    res.set('Retry-After', String(rateCheck.retryAfter));
    return res.status(429).json({
      error: `Too many login attempts. Try again in ${Math.ceil(rateCheck.retryAfter / 60)} minutes.`,
      retryAfter: rateCheck.retryAfter,
    });
  }

  if (!process.env.APP_PASSWORD) {
    // No password set → no auth required → return a permanent token
    if (!SESSION_SECRET) {
      return res.status(500).json({ error: 'Server misconfigured: set SESSION_SECRET or APP_PASSWORD' });
    }
    return res.json({ token: signToken({ exp: Date.now() + SESSION_DURATION_MS, sub: 'no-auth' }) });
  }
  const { password } = req.body || {};
  if (!password || !constantTimeEqual(password, process.env.APP_PASSWORD)) {
    return res.status(401).json({
      error: 'Incorrect password',
      attemptsRemaining: rateCheck.remaining,
    });
  }
  const token = signToken({ exp: Date.now() + SESSION_DURATION_MS, sub: 'admin' });
  // Reset rate-limit counter on successful login
  LOGIN_ATTEMPTS.delete(ip);
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
  'site-health': (opts) => siteHealth(makeGsc(), { days: p({ ...opts, days: opts.days || 90 }, 'days') }),
  'overview': (opts) => overview(makeGsc(), parseDays(opts)),
  'top-queries': (opts) => topQueries(makeGsc(), { ...parseDays(opts), limit: p(opts, 'limit'), brand: opts.brand || null }),
  'top-pages': (opts) => topPages(makeGsc(), { ...parseDays(opts), limit: p(opts, 'limit') }),
  'devices': (opts) => devices(makeGsc(), parseDays(opts)),
  'countries': (opts) => countries(makeGsc(), { ...parseDays(opts), limit: p(opts, 'limit') }),
  'ctr-opportunities': (opts) => ctrOpportunities(makeGsc(), {
    ...parseDays(opts), minImpressions: p(opts, 'minImpressions'), maxPosition: p(opts, 'maxPosition'),
  }),
  'year-over-year': (opts) => yearOverYear(makeGsc(), parseDays(opts)),
  'winners-losers': (opts) => winnersLosers(makeGsc(), { ...parseDays(opts), limit: p(opts, 'limit') }),
  'ranking-heatmap': (opts) => rankingHeatmap(makeGsc(), {
    months: p(opts, 'months'), topQueries: p(opts, 'topQueries'),
  }),
  'content-gaps': (opts) => contentGaps(makeGsc(), {
    ...parseDays(opts),
    minImpressions: p(opts, 'minImpressions'),
    minPosition: p(opts, 'minPosition'),
    maxPosition: p(opts, 'maxPosition'),
  }),
  'ai-overview-impact': (opts) => aiOverviewImpact(makeGsc(), {
    ...parseDays(opts),
    minImpressions: p(opts, 'minImpressions'),
  }),
};

app.get('/api/reports/:type', async (req, res) => {
  const fn = REPORTS[req.params.type];
  if (!fn) return res.status(404).json({ error: `Unknown report: ${req.params.type}` });
  if (!isAuthorized()) return res.status(401).json({ error: 'Not authorized' });
  if (!process.env.GSC_SITE_URL) return res.status(500).json({ error: 'GSC_SITE_URL not set' });
  const reportStart = Date.now();
  try {
    const report = await fn(req.query);
    // Fire-and-forget DB logging (no-op if DATABASE_URL not set)
    logReport({
      reportType: req.params.type,
      siteUrl: process.env.GSC_SITE_URL,
      params: req.query,
      durationMs: Date.now() - reportStart,
    });
    // If the report contains query/keyword data, log those too for keywords_tracked count
    try {
      const queries = [];
      if (Array.isArray(report?.rows)) {
        for (const row of report.rows) {
          if (row?.query) queries.push(String(row.query));
        }
      }
      if (Array.isArray(report?.queries)) {
        for (const row of report.queries) {
          if (row?.query) queries.push(String(row.query));
        }
      }
      if (queries.length) logKeywords(process.env.GSC_SITE_URL, queries);
    } catch { /* keyword logging is best-effort */ }
    // CSV format: ?format=csv → text/csv response
    if (req.query.format === 'csv') {
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${req.params.type}-${new Date().toISOString().slice(0, 10)}.csv"`);
      return res.send(reportToCSV(report));
    }
    res.json(report);
  } catch (err) {
    console.error(`Report '${req.params.type}' failed:`, err);
    const msg = String(err.message || '');
    let category = 'unknown';
    let userMsg = msg;
    if (msg.includes('quota') || msg.match(/429|rate.?limit/i)) {
      category = 'quota';
      userMsg = 'Google Search Console rate limit hit. Wait a minute and try again.';
    } else if (msg.includes('invalid_grant') || msg.includes('Not authorized')) {
      category = 'auth';
      userMsg = 'Google authorization expired. Re-authorize from the dashboard.';
    } else if (msg.match(/ENOTFOUND|ECONNREFUSED|timeout/i)) {
      category = 'network';
      userMsg = 'Network error reaching Google. Try again in a moment.';
    } else if (msg.includes('GSC_SITE_URL')) {
      category = 'config';
      userMsg = 'Site URL not configured on backend. Set GSC_SITE_URL.';
    }
    res.status(500).json({ error: userMsg, category, detail: msg });
  }
});

// Algorithm update timeline — frontend uses this for chart overlays.
app.get('/api/algorithm-updates', (req, res) => {
  res.json({ updates: ALGORITHM_UPDATES });
});

// ═══ FINANCE MINISTER HUB CONNECTOR ═══
// Lightweight admin endpoints consumed by the Finance Minister Hub dashboard.
// Auth via HUB_API_KEY env var (separate from APP_PASSWORD used by the UI).
const HUB_API_KEY = process.env.HUB_API_KEY || '';

function hubAuth(req, res, next) {
  const key = req.headers['x-hub-key'] || (req.headers['authorization'] || '').replace('Bearer ', '');
  if (!HUB_API_KEY || key !== HUB_API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
}

app.get('/api/hub/health', hubAuth, (req, res) => {
  res.json({
    status: 'healthy',
    service: 'gsc-seo-reporter',
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString(),
    gsc_authorized: isAuthorized(),
    ai_configured: isAIConfigured(),
    database: getDbStatus(),
  });
});

app.get('/api/hub/stats', hubAuth, async (req, res) => {
  try {
    const [metrics, recent] = await Promise.all([
      getMetrics(),
      getRecentReports(5),
    ]);
    res.json({
      service: 'gsc-seo-reporter',
      metrics,
      recentActivity: recent,
      actions: [
        { id: 'sync', label: 'Sync Data' },
        { id: 'open-dashboard', label: 'Open Dashboard', url: process.env.FRONTEND_URL || null },
      ],
      generatedAt: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
// ═══ END HUB CONNECTOR ═══

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

// Discover keyword targets — works WITHOUT GSC ranking data (for new/small sites)
app.post('/api/ai/keyword-discovery', aiGuard, async (req, res) => {
  try {
    const { existingQueries = [], siteContext = '', focus = 'general' } = req.body || {};
    const result = await discoverKeywords({ existingQueries, siteContext, focus });
    res.json(result);
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generate a complete article brief from a topic — standalone, no GSC needed
app.post('/api/ai/content-brief', aiGuard, async (req, res) => {
  try {
    const { topic, targetKeyword, siteContext = '', wordCount = 1800 } = req.body || {};
    if (!topic && !targetKeyword) return res.status(400).json({ error: 'topic or targetKeyword required' });
    const result = await generateBrief({ topic, targetKeyword, siteContext, wordCount });
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

// Safe parameter parsing — bounded with explicit min/max from seo-constants.
function p(opts, key) {
  const bounds = BOUNDS[key];
  if (!bounds) throw new Error(`Unknown bounded param: ${key}`);
  return boundedInt(opts[key], bounds);
}
function parseDays(opts) { return { days: p(opts, 'days') }; }

// ─── Start ──────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  // Run DB migrations (no-op if DATABASE_URL not set; non-blocking)
  migrate().catch((err) => console.error('[startup] migrate failed:', err.message));

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
