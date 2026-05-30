# SETUP — read this once, follow top to bottom

This is the **only document you need** to get the SEO tool fully working. Every step has exact values to paste.

Your two Railway services:
- **Backend** = `ai-seo-backend-production-6281.up.railway.app` (replace with yours)
- **Frontend** = `ai-seo-frontend-production.up.railway.app` (replace with yours)

When in doubt, visit **`https://YOUR-BACKEND.up.railway.app/api/diag`** in any browser tab. It shows exactly which env vars are set, missing, or wrong. **Use this as your debugging tool.**

---

## Step 1 — Push both folders to GitHub

You have two zips: `gsc-backend.zip` and `gsc-frontend.zip`. Create **two separate GitHub repos** and push each.

---

## Step 2 — Backend variables on Railway

Go to Railway → **backend service** (`ai-seo-backend`) → **Variables** tab → add these one by one.

**Copy each value EXACTLY. No quotes. No spaces. No trailing slashes on URLs.**

| Variable name | Value to paste |
|---|---|
| `APP_URL` | `https://ai-seo-backend-production-6281.up.railway.app` |
| `FRONTEND_URL` | `https://ai-seo-frontend-production.up.railway.app` |
| `GSC_SITE_URL` | `sc-domain:thevitaminshots.com` |
| `APP_PASSWORD` | (any strong password — write it down) |
| `OPENAI_API_KEY` | `sk-...` (from https://platform.openai.com/api-keys) |
| `OPENAI_MODEL` | `gpt-4o-mini` (cheap and good — leave as-is) |
| `SITE_DESCRIPTION` | (see below — dramatically improves AI suggestion quality) |

**SITE_DESCRIPTION value**: 1-3 sentences describing your business. This is passed as context to every AI call — without it, the AI doesn't know what you sell or who your customers are, so its title rewrites and content briefs will be generic.

Example for your site:
```
DTC vegan liquid vitamin brand. Sells monthly subscriptions for Vitamin Shots ($89.99), Glam Dust ($44.99), and Vitamin Sprinkles ($49.99). US-based, ships globally. Customers are wellness-focused women 25-45.
```

The more specific you are (price points, audience, what makes you different), the better the AI suggestions get.

**Do NOT set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, or `GOOGLE_REFRESH_TOKEN` yet** — you'll get those values in Step 3.

After saving these, Railway auto-redeploys. Wait ~60 seconds.

**Verify it worked:** open `https://YOUR-BACKEND.up.railway.app/api/diag` in your browser. You'll see JSON. It should say `GSC_SITE_URL: "sc-domain:thevitaminshots.com"`, `FRONTEND_URL: ...`, etc. If anything still says `MISSING`, you didn't save it correctly.

---

## Step 3 — Get Google OAuth credentials

You need a Google Cloud project with OAuth credentials. This part is 100% in the Google Cloud console.

### 3a — Create the project

1. Open **[console.cloud.google.com](https://console.cloud.google.com)** in a new tab
2. Top-left, click the project dropdown → **NEW PROJECT** (top-right of popup)
3. Project name: `GSC SEO Reporter` → click **CREATE**
4. Wait ~10 sec → click the project dropdown again → select your new project (must say it at the top)

### 3b — Enable the Search Console API

1. Left menu (☰ icon) → **APIs & Services** → **Library**
2. Search box: `Google Search Console API`
3. Click the result → click big blue **ENABLE** button
4. Wait until it says "API enabled"

### 3c — Configure the consent screen

1. Left menu → **APIs & Services** → **OAuth consent screen**
2. User Type: pick **External** → click **CREATE**
3. Fill in only the required fields:
   - **App name**: `GSC SEO Reporter`
   - **User support email**: your email (dropdown)
   - **Developer contact information** (bottom): your email
4. Click **SAVE AND CONTINUE**
5. **Scopes** page → just click **SAVE AND CONTINUE** (don't add anything)
6. **Test users** page → click **+ ADD USERS** → enter the Google email that has access to your Search Console property → click **ADD** → **SAVE AND CONTINUE**
7. Click **BACK TO DASHBOARD**

### 3d — Create the OAuth client (this gives you Client ID + Secret)

1. Left menu → **APIs & Services** → **Credentials**
2. Top of page click **+ CREATE CREDENTIALS** → **OAuth client ID**
3. Application type: **Web application** ⚠️ MUST be Web application, NOT Desktop
4. Name: `GSC Backend`
5. Under **Authorized redirect URIs** → click **+ ADD URI** → paste this exact value (replacing with your backend URL):

   ```
   https://ai-seo-backend-production-6281.up.railway.app/api/auth/callback
   ```

   ⚠️ Must end with `/api/auth/callback`. No trailing slash after that.

6. Click **CREATE**

A popup appears with **Client ID** (ends in `.apps.googleusercontent.com`) and **Client secret** (starts with `GOCSPX-`).

**Copy both into your notes app NOW.** You can come back to view them later but copy them now.

### 3e — Paste into Railway

Railway → backend service → Variables → add:

| Variable name | Value to paste |
|---|---|
| `GOOGLE_CLIENT_ID` | (the long one ending in `.apps.googleusercontent.com`) |
| `GOOGLE_CLIENT_SECRET` | (the one starting with `GOCSPX-`) |

Backend auto-redeploys. Wait ~60 sec.

**Verify**: visit `/api/diag` again → should now show `GOOGLE_CLIENT_ID: set` and `GOOGLE_CLIENT_SECRET: set`. The `status` field should say `"READY ✓"` *except* for `Complete OAuth flow and add GOOGLE_REFRESH_TOKEN` (that's next).

---

## Step 4 — Frontend variables on Railway

Go to Railway → **frontend service** (`ai-seo-frontend`) → **Variables** tab.

| Variable name | Value to paste |
|---|---|
| `VITE_API_URL` | `https://ai-seo-backend-production-6281.up.railway.app` |

✅ **GOOD NEWS**: This version of the frontend reads `VITE_API_URL` at **runtime** (not just build time). So:
1. Save the variable
2. Railway auto-redeploys (no need to manually trigger a rebuild)
3. Wait ~60 seconds
4. Done

If you ever need to change the backend URL later, just update `VITE_API_URL` → Railway redeploys → it works immediately. No more "I set the variable but it didn't take effect" problem.

**Verify it worked**: visit `https://YOUR-FRONTEND.up.railway.app/health` — should return:
```json
{"ok":true,"apiUrl":"https://YOUR-BACKEND.up.railway.app","apiUrlConfigured":true}
```

If `apiUrlConfigured` is `false`, the variable isn't set or the redeploy didn't pick it up.

---

## Step 5 — Authorize Google Search Console

1. Open your **frontend** URL: `https://ai-seo-frontend-production.up.railway.app`
2. Browser prompts for password → username: `admin`, password: your `APP_PASSWORD`
3. You'll see the dashboard with a yellow banner: **"Not authorized yet"** → click **Authorize →**
4. Google sign-in page opens → sign in with the **same email you added as a Test User** in Step 3c
5. You may see: **"Google hasn't verified this app"** — this is normal because it's your own private app:
   - Click **Advanced** (small link at bottom)
   - Click **Go to GSC SEO Reporter (unsafe)**
6. Consent screen → click **Continue** / **Allow**
7. You land back on your frontend at `/auth-success` showing a **refresh token**
8. Click **Copy token**
9. Go back to Railway → **backend** service → Variables → add:

| Variable name | Value to paste |
|---|---|
| `GOOGLE_REFRESH_TOKEN` | (paste the token from step 8) |

Backend auto-redeploys. Wait ~60 sec.

**You're done. Permanently.**

Visit `/api/diag` one more time. The `status` field should now say `"READY ✓"`.

Go to your frontend → click "Generate →" on any report card. Real data should load.

---

## What can go wrong, and the fix

### "Cannot reach backend at ..." banner on frontend

Your `VITE_API_URL` is wrong. Go to the URL it shows + `/api/diag`. If that 404s → URL is wrong. Fix and **Redeploy** the frontend.

### "Backend not configured" banner

`GSC_SITE_URL` not set. Check `/api/diag` to confirm.

### "Not authorized yet" banner persists even after authorizing

`GOOGLE_REFRESH_TOKEN` not pasted back into Railway, OR pasted on the wrong service (must be backend, not frontend).

### Google says "redirect_uri_mismatch" when you click Authorize

The URL in Google Cloud → Credentials → OAuth Client → Authorized redirect URIs **doesn't exactly match** `APP_URL + /api/auth/callback`. Visit `/api/diag` and look at `oauth.expectedRedirectUri` — that exact value must be in Google Cloud. No trailing slashes anywhere.

### Google says "Access blocked: app has not completed verification"

You forgot to add yourself as a Test User in Step 3c. Go back to OAuth consent screen → Test users → add your email.

### Report card "Generate →" returns an error

If the error mentions "GSC API" or "404" — your `GSC_SITE_URL` is in the wrong format. Two formats:
- **Domain property** (most common): `sc-domain:thevitaminshots.com` (no `https://`, no slash)
- **URL-prefix property**: `https://thevitaminshots.com/` (with `https://` and trailing slash)

Check which type you have at [search.google.com/search-console](https://search.google.com/search-console).

### OpenAI / AI buttons return error

Your `OPENAI_API_KEY` is wrong, expired, or out of credits. Test by visiting [platform.openai.com/api-keys](https://platform.openai.com/api-keys) — make sure the key is active. Check you have at least $5 in credits at [platform.openai.com/settings/organization/billing/overview](https://platform.openai.com/settings/organization/billing/overview).

---

## Cheap OpenAI models comparison

The default `gpt-4o-mini` costs **~$0.15 per million input tokens, $0.60 per million output**. For your usage (generating ~5–20 summaries per day), that's **less than $1/month**.

If you want better quality, set `OPENAI_MODEL` to:
- `gpt-4o-mini` ← default, cheapest, recommended
- `gpt-4.1-mini` ← newer, slightly better, ~3× cost
- `gpt-4o` ← best quality, ~15× cost

All work with the same `OPENAI_API_KEY`.

---

## How to verify everything is working (final checklist)

1. ✅ Visit `https://YOUR-BACKEND.up.railway.app/api/diag` → JSON shows `status: "READY ✓"`
2. ✅ Visit your frontend → no red error banners
3. ✅ Click "Generate →" on "Search Performance" → real data loads, charts appear
4. ✅ Click the purple "✨ AI Executive Summary" button → AI analysis appears in a modal
5. ✅ Click the floating "Ask AI" button (bottom right) → chat opens, ask anything
6. ✅ Go to CTR Win Candidates report → click "AI: Rewrite Titles" → AI generates 3 variants per query

If all 6 work, you have a perfect AI SEO tool.
