# GSC SEO Reporter — Backend

Express API that pulls Google Search Console data and adds AI-powered SEO analysis via OpenAI.

Pairs with [gsc-frontend](#) (deployed as a separate Railway service).

## Endpoints

```
GET  /api/health                         public — no auth
GET  /api/auth/callback                  public — Google OAuth redirect target
GET  /api/config                         protected
GET  /api/auth/status                    protected
GET  /api/auth/url                       protected
GET  /api/sites                          protected
GET  /api/reports/:type                  protected
POST /api/ai/summarize                   protected + needs OPENAI_API_KEY
POST /api/ai/title-rewrites              protected + needs OPENAI_API_KEY
POST /api/ai/diagnose                    protected + needs OPENAI_API_KEY
POST /api/ai/cluster                     protected + needs OPENAI_API_KEY
POST /api/ai/chat                        protected + needs OPENAI_API_KEY
```

Report types: `overview`, `top-queries`, `top-pages`, `devices`, `countries`, `ctr-opportunities`, `year-over-year`, `winners-losers`, `ranking-heatmap`, `content-gaps`.

## Deploy to Railway

### 1. Push to a new GitHub repo

```bash
cd gsc-backend
git init && git add . && git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/gsc-backend.git
git push -u origin main
```

### 2. Create the Railway service

1. [railway.app](https://railway.app/) → **+ New Project** → **Deploy from GitHub repo** → pick the backend repo
2. **Settings → Networking → Generate Domain**. Copy the URL (e.g. `https://gsc-backend-production.up.railway.app`)
3. You'll set the variables in step 4, after creating Google OAuth credentials

### 3. Google OAuth credentials

1. [Google Cloud Console → Create Project](https://console.cloud.google.com/projectcreate)
2. [APIs & Services → Library](https://console.cloud.google.com/apis/library) → search **"Google Search Console API"** → **Enable**
3. [OAuth consent screen](https://console.cloud.google.com/apis/credentials/consent):
   - User Type: **External** → Create
   - App name + your email → Save
   - Scopes: skip → Save
   - Test users: add your Google email → Save
4. [Credentials](https://console.cloud.google.com/apis/credentials) → **+ Create Credentials → OAuth client ID**:
   - Type: **Web application**
   - **Authorized redirect URIs** → **+ ADD URI** → paste `<backend-railway-url>/api/auth/callback`
   - Create → copy **Client ID** and **Client Secret**

### 4. Set Railway variables on the BACKEND service

In Railway → backend service → **Variables**:

| Variable | Required | Value |
|---|:---:|---|
| `GOOGLE_CLIENT_ID` | ✓ | From step 3 |
| `GOOGLE_CLIENT_SECRET` | ✓ | From step 3 |
| `APP_URL` | ✓ | Your **backend** Railway URL, no trailing slash |
| `GSC_SITE_URL` | ✓ | `sc-domain:thevitaminshots.com` (or `https://thevitaminshots.com/` for URL-prefix properties) |
| `FRONTEND_URL` | ✓ | Your **frontend** Railway URL (for CORS) — deploy the frontend first to get this |
| `OPENAI_API_KEY` | ✓ for AI | `sk-...` from [platform.openai.com/api-keys](https://platform.openai.com/api-keys) |
| `OPENAI_MODEL` | optional | Default `gpt-4o-mini`. Alternatives: `gpt-4o`, `gpt-4-turbo` |
| `APP_PASSWORD` | recommended | Strong password. Frontend prompts for this. Username always `admin`. |
| `API_KEY` | optional | Random string. If set, frontend must send it as `X-API-Key` header. Match `VITE_API_KEY` on the frontend. |
| `GOOGLE_REFRESH_TOKEN` | after 1st auth | Filled in after first OAuth — persists auth across restarts |
| `MOCK_GSC` | optional | `true` → use synthetic data (preview without real GSC) |

Railway auto-redeploys on each variable change.

### 5. Connect Google Search Console (one-time)

1. Visit your **frontend** URL → log in with `admin` / `APP_PASSWORD`
2. Click "Authorize →" in the banner
3. Sign in with Google → consent
4. You'll land on `/auth-success` showing a refresh token
5. Copy the token → backend Railway → Variables → add `GOOGLE_REFRESH_TOKEN`
6. Backend redeploys. Auth persists permanently.

## Local development

```bash
npm install
cp .env.example .env  # fill in your values
npm run dev           # starts on :3001 with --watch
```

For local OAuth, add `http://localhost:3001/api/auth/callback` as a redirect URI in Google Cloud.

**Preview without setting up Google OAuth:**
```bash
MOCK_GSC=true GSC_SITE_URL="sc-domain:demo.com" APP_URL=http://localhost:3001 \
  FRONTEND_URL=http://localhost:5173 GOOGLE_CLIENT_ID=x GOOGLE_CLIENT_SECRET=x \
  npm run dev
```

## How AI features work

Five OpenAI-powered endpoints, each tuned with a different system prompt and temperature:

| Endpoint | Use | Returns |
|---|---|---|
| `/ai/summarize` | 3-paragraph executive summary of any report | Markdown |
| `/ai/title-rewrites` | 3 title + meta variants per CTR-opportunity query | JSON |
| `/ai/diagnose` | Hypothesizes causes for traffic drops with investigation steps | JSON |
| `/ai/cluster` | Groups gap queries into content briefs | JSON |
| `/ai/chat` | Free-form Q&A with optional report context | Plain text |

Structured endpoints (`title-rewrites`, `diagnose`, `cluster`) use OpenAI's JSON response format. Default model is `gpt-4o-mini` — cheap (~$0.15 per 1M input tokens), fast, and good enough for SEO analysis. Set `OPENAI_MODEL=gpt-4o` for higher quality at ~10× the cost.

## License

MIT

---

## Finance Minister Hub Connector

This backend exposes two read-only endpoints for the Finance Minister Hub dashboard:

- `GET /api/hub/health` — service status, uptime, GSC/AI/database readiness
- `GET /api/hub/stats` — counts and recent activity from the database

### Auth

Both endpoints require the `HUB_API_KEY` env var. Send it as either:
- `x-hub-key: <key>` header, or
- `Authorization: Bearer <key>` header

### Database

When `DATABASE_URL` is set (Railway injects this automatically when a Postgres
service is linked), the backend logs every successful `/api/reports/:type` call
to a `reports_log` table and tracks distinct sites + keywords. The Hub stats
endpoint reads from these tables.

If `DATABASE_URL` is not set, the Hub endpoints still respond — metrics simply
report zeros and `database: not_connected`. The rest of the app is unaffected.

### Tables created automatically on startup

- `reports_log`     — one row per report request (type, site, params, duration, timestamp)
- `sites_seen`      — distinct GSC sites with first/last seen + report count
- `keywords_tracked` — distinct (site, query) pairs from report responses

### Env vars

| Var            | Required? | Description                                                                 |
|----------------|-----------|-----------------------------------------------------------------------------|
| `HUB_API_KEY`  | yes (for Hub) | Secret key the Hub dashboard sends in every request.                    |
| `DATABASE_URL` | optional      | Railway-style Postgres connection string. Auto-injected when Postgres service is linked. Without this, Hub stats return zeros. |

### Example

```bash
curl -H "x-hub-key: $HUB_API_KEY" https://your-backend.up.railway.app/api/hub/health
curl -H "x-hub-key: $HUB_API_KEY" https://your-backend.up.railway.app/api/hub/stats
```
