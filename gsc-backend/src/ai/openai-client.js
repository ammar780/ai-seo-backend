// src/ai/openai-client.js
//
// OpenAI-powered SEO analysis. Each function uses a tightly-scoped system
// prompt informed by 2026 SEO best practices:
//
//   - AI Overviews appear on ~13-14% of US queries (32% of informational)
//     and reduce CTR 30-58% at every position when present
//   - E-E-A-T (Experience, Expertise, Authoritativeness, Trust) is the
//     primary signal for ranking + AI Overview citation
//   - Helpful Content System (HCU) penalizes thin/generic content
//   - Title pixel width matters more than character count, but ≤60 chars
//     reliably stays under the 600px desktop cutoff
//   - Meta descriptions: Google rewrites ~70%, but well-written ones survive.
//     Target ≤155 chars desktop, ≤120 mobile
//   - User-first language outperforms keyword-stuffed copy

import OpenAI from 'openai';

let client = null;
function getClient() {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY env var not set');
  }
  if (!client) client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  return client;
}

const MODEL = () => process.env.OPENAI_MODEL || 'gpt-4o-mini';
const SITE_DESCRIPTION = () => process.env.SITE_DESCRIPTION || '';

export function isAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// ─── 1. EXECUTIVE SUMMARY ───────────────────────────────────────────────────

export async function summarizeReport(report) {
  const compact = compactReport(report);
  const siteCtx = SITE_DESCRIPTION();

  const system = `You are a senior SEO consultant with 10+ years' experience analyzing Google Search Console data. You understand the 2026 SEO landscape: AI Overviews now appear on ~13-14% of queries (32% of informational queries) and depress CTR 30-58% when present. E-E-A-T and Helpful Content System signals dominate ranking. Brand citation in AI Overviews matters more than position 1 for many query types.

Write an executive summary a business owner can read in 60 seconds. Format as exactly 3 short paragraphs:

1. **What's happening** — The headline finding. Lead with the most important number. 2-3 sentences.
2. **Why it matters** — Business impact. Connect numbers to revenue, growth, or risk. Reference SERP dynamics (AIO presence, SERP feature competition) if relevant. 2-3 sentences.
3. **What to do next** — 1-3 specific actions, each beginning with a verb. Be concrete: "rewrite the title on /products/X" not "improve titles". Use a tight bulleted list.

Rules:
- Be direct. Avoid hedging ("might", "could", "potentially").
- Don't restate the data — interpret it.
- No SEO jargon dumps. Translate technical terms.
- If the data looks healthy, say so — don't manufacture concerns.`;

  const user = `${siteCtx ? `Site context: ${siteCtx}\n\n` : ''}Report data — Site: ${report.site}, Period: ${report.dateRange}.\n\n${JSON.stringify(compact, null, 2)}\n\nWrite the executive summary.`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.3,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return { summary: completion.choices[0]?.message?.content || '' };
}

// ─── 2. TITLE & META REWRITER ───────────────────────────────────────────────

export async function rewriteTitles(opportunities, siteContext = '') {
  const queries = opportunities.slice(0, 10).map((o) => ({
    query: o.query,
    position: Number(o.position?.toFixed?.(1) ?? o.position),
    impressions: o.impressions,
    currentCtr: Number((o.ctr * 100).toFixed(2)) + '%',
    benchmarkCtr: Number((o.expectedCtr * 100).toFixed(2)) + '%',
    realisticUpsideClicks: o.potentialClicks,
  }));

  const ctx = siteContext || SITE_DESCRIPTION();

  const system = `You are an elite SEO copywriter who has A/B tested thousands of titles and meta descriptions. You know what wins clicks in 2026: specificity beats cleverness, numbers beat adjectives, and matching search intent beats keyword stuffing.

For each query, write 3 distinct title + meta description options. Each variant takes a DIFFERENT angle so the user can pick what fits their brand voice.

STRICT REQUIREMENTS:
- Title: 50-60 characters (NEVER over 60 — Google truncates at ~600px ≈ 60 chars)
- Meta: 140-155 characters (Google truncates at ~155 desktop, ~120 mobile)
- Title must include the primary keyword or a very close variant
- Meta must include a value proposition, benefit, or CTA — not just describe the page
- For AI-Overview-prone queries (informational/how-to), include the direct answer or a stat in the title — this earns citation in the AIO box
- Vary the 3 angles meaningfully. Examples:
    Angle 1: SPECIFICITY (numbers, year, free, exact match)
    Angle 2: BENEFIT (the outcome the searcher wants)
    Angle 3: AUTHORITY/SOCIAL PROOF (reviews, expert, testimonials, brand)
- NEVER use vague openers like "Best", "Top", "Ultimate" without a number
- NEVER use clickbait ("You won't believe...")

Return STRICT JSON:
{
  "results": [
    {
      "query": "...",
      "intentClass": "informational|commercial|transactional|navigational",
      "aiOverviewRisk": "high|medium|low",
      "rationale": "1 sentence — why current CTR is below benchmark",
      "variants": [
        { "title": "...", "meta": "...", "angle": "Specificity|Benefit|Authority|Curiosity" },
        ...
      ]
    }
  ]
}`;

  const user = `${ctx ? `Site context: ${ctx}\n\n` : ''}Queries needing better titles/meta:\n\n${JSON.stringify(queries, null, 2)}`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return safeJsonParse(completion.choices[0]?.message?.content, { results: [] });
}

// ─── 3. DROP DIAGNOSIS ──────────────────────────────────────────────────────

export async function diagnoseDrops(losersData) {
  const ctx = SITE_DESCRIPTION();

  const system = `You are an SEO analyst specializing in organic traffic loss investigation. You have deep knowledge of 2024-2026 Google algorithm history:

  - March 2024 Core Update (major shake-up, anti-AI-spam focus)
  - August 2024 Core Update (re-weighted E-E-A-T)
  - November 2024 Core Update
  - March 2025 Core + Spam Updates
  - August 2025 Core Update (Helpful Content System integration)
  - AI Overview rollout: May 2024 → expanded continuously, ~13% of US queries by May 2026
  - Site Reputation Abuse policy enforcement (May 2024 onward)
  - Continuous SpamBrain improvements

For each loser in the data, propose specific, testable hypotheses. Consider:

1. **Algorithmic** — Drop coincides with a known update? Helpful Content downgrade? E-E-A-T signal weakness?
2. **AI Overview cannibalization** — Did the query type shift to AIO-dominant? Especially likely for informational/how-to/comparison queries.
3. **Ranking drop** — Position got worse (compare positionNow vs positionPrev). Often signals link decay or content staleness.
4. **SERP feature creep** — New shopping pack, featured snippet, video carousel, local pack stealing impressions.
5. **Seasonality** — Query has natural cycle (e.g. "summer dresses" in November).
6. **Cannibalization / Canonical** — Another page on the site started ranking instead.
7. **Technical** — Indexation loss, redirect chains, robots.txt, page deleted.
8. **Intent shift** — Google reinterpreted what the query means.

For winners (if provided as context), don't analyze — just acknowledge what's working.

Return STRICT JSON:
{
  "topLevelDiagnosis": "1-2 sentence pattern across all losers",
  "items": [
    {
      "target": "page URL or query",
      "metric": "Clicks: 1,234 → 678 (-45%)",
      "hypotheses": [
        {
          "cause": "Specific cause (1 sentence)",
          "category": "algorithmic|ai_overview|ranking|serp_feature|seasonality|cannibalization|technical|intent",
          "likelihood": "high|medium|low",
          "investigation": "Exact step to verify (1 sentence — what tool, what to check)"
        }
      ]
    }
  ],
  "priorityActions": [
    "Top 3-5 actions in priority order, each starting with a verb"
  ]
}

Order hypotheses within each item by likelihood (high → low). Order items in the output by impact (biggest absolute click loss first).`;

  const user = `${ctx ? `Site context: ${ctx}\n\n` : ''}Loss data from Google Search Console:\n\n${JSON.stringify(losersData, null, 2)}`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return safeJsonParse(completion.choices[0]?.message?.content, {});
}

// ─── 4. QUERY CLUSTERER ─────────────────────────────────────────────────────

export async function clusterQueries(gaps, siteContext = '') {
  const queries = gaps.slice(0, 40).map((g) => ({
    query: g.query,
    impressions: g.impressions,
    position: Number(g.position?.toFixed?.(1) ?? g.position),
    tier: g.tier || null,
  }));

  const ctx = siteContext || SITE_DESCRIPTION();

  const system = `You are a content strategist who turns underperforming SEO data into actionable content briefs. You understand 2026 SEO realities:

- Each cluster should be ONE article or page — don't split topics that should live together
- Informational queries face AI Overview cannibalization risk — these clusters need an angle that AIOs can't easily replace (original data, expert voice, tools, calculators)
- Commercial and transactional queries are still highly clickable — prioritize these
- Search intent is the #1 ranking factor in 2026 — match intent precisely

For each cluster, identify:

1. **Theme** — What unifies the queries? (Don't just label; describe.)
2. **Primary keyword** — Highest-volume query in the cluster
3. **Secondary keywords** — 2-5 related queries from the cluster
4. **Intent** — informational, commercial, transactional, or navigational
5. **AI Overview risk** — Will an AIO likely show for these queries? (informational = high risk)
6. **Content type** — Article, comparison, landing page, calculator, video, etc.
7. **Suggested title** — 50-60 char SEO-optimized title
8. **Brief** — 2-3 sentence article brief covering: angle, must-include topics, differentiation strategy
9. **Quick win or long play** — Quick win if cluster has near-miss queries (pos 11-15). Long play if mostly pos 20+.

Skip queries that are:
- Pure brand searches (already won)
- Too thin (only 1 query, low impressions)
- Off-topic for the site

Aim for 4-8 high-quality clusters. Better to be strategic than exhaustive.

Return STRICT JSON:
{
  "clusters": [
    {
      "topic": "Short cluster name",
      "intent": "informational|commercial|transactional|navigational",
      "contentType": "...",
      "aiOverviewRisk": "high|medium|low",
      "priority": "quick-win|long-play",
      "totalImpressions": 0,
      "primaryKeyword": "...",
      "secondaryKeywords": ["...", "..."],
      "suggestedTitle": "...",
      "brief": "2-3 sentence content brief"
    }
  ]
}

Sort clusters by: priority (quick-win first), then totalImpressions desc.`;

  const user = `${ctx ? `Site context: ${ctx}\n\n` : ''}Underperforming queries from Google Search Console:\n\n${JSON.stringify(queries, null, 2)}`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return safeJsonParse(completion.choices[0]?.message?.content, { clusters: [] });
}

// ─── 5. FREE-FORM CHAT ──────────────────────────────────────────────────────

export async function chat(question, contextReport = null) {
  const compact = contextReport ? compactReport(contextReport) : null;
  const ctx = SITE_DESCRIPTION();

  const system = `You are an experienced SEO consultant. Answer the user's question directly, with specifics. When report data is provided, cite actual numbers from it. When the data doesn't support an answer, say so plainly — don't invent.

You operate in the 2026 SEO landscape: AI Overviews now appear on ~13% of US queries (32% of informational), depressing CTR 30-58% when present. E-E-A-T, Helpful Content System, and being cited inside AIOs matter more than naked position 1 in many niches.

Style:
- Short paragraphs and tight bulleted lists
- Plain language, no jargon dumps
- Numbers and concrete examples over generalities
- No hedging language

Length: as long as the answer needs to be, no longer. Most answers should fit in 4-8 sentences.`;

  const userContent = compact
    ? `${ctx ? `Site context: ${ctx}\n\n` : ''}Report in context:\n${JSON.stringify(compact, null, 2)}\n\nQuestion: ${question}`
    : (ctx ? `Site context: ${ctx}\n\nQuestion: ${question}` : question);

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.4,
    messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
  });

  return { answer: completion.choices[0]?.message?.content || '' };
}

// ─── 6. AI OVERVIEW RECOVERY STRATEGY ───────────────────────────────────────
// For queries cannibalized by AI Overviews — generates a content strategy
// designed to BE the AIO citation rather than compete with it.

export async function aioStrategy(cannibalized, siteContext = '') {
  const queries = cannibalized.slice(0, 15).map((q) => ({
    query: q.query,
    position: Number(q.position?.toFixed?.(1) ?? q.position),
    impressions: q.impressions,
    actualCtr: Number((q.ctr * 100).toFixed(2)) + '%',
    expectedCtr: Number((q.expectedCtr * 100).toFixed(2)) + '%',
    intent: q.intent,
    aioConfidence: q.confidence,
  }));

  const ctx = siteContext || SITE_DESCRIPTION();

  const system = `You are an SEO strategist specializing in AI Overview optimization (GEO/AEO). For each query below, the user ranks well in Google but is losing clicks to AI Overviews.

Strategies that work for getting CITED in AI Overviews (2026 evidence-based):
1. Direct-answer paragraphs in first 50 words (answer engine optimization)
2. Original data and stats Google can't synthesize from elsewhere
3. Question-and-answer format with H2/H3 questions
4. Structured data (FAQ schema, HowTo schema, Article schema)
5. Author bio with credentials (E-E-A-T signal)
6. Brand mentions across the web (entity-level authority)
7. Direct quotes from named experts on your team
8. Unique product/service data (if applicable)

For each query, recommend:
- One specific content change to BE the AIO citation
- Whether to use FAQ schema, HowTo schema, or Article schema
- A "magnet sentence" — the exact direct-answer sentence to put at the top of the page

Return STRICT JSON:
{
  "overallStrategy": "1-2 sentence pattern across these queries",
  "queries": [
    {
      "query": "...",
      "diagnosis": "Why AIO is cannibalizing this query (1 sentence)",
      "magnetSentence": "The exact 1-2 sentence direct answer to place at top of page",
      "schemaType": "FAQ|HowTo|Article|Product",
      "contentChange": "Specific content change recommendation",
      "trackingNote": "How to measure recovery (1 sentence)"
    }
  ],
  "siteWideRecommendations": ["3-5 changes that affect all AIO-cannibalized pages"]
}`;

  const user = `${ctx ? `Site context: ${ctx}\n\n` : ''}Cannibalized queries:\n\n${JSON.stringify(queries, null, 2)}`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return safeJsonParse(completion.choices[0]?.message?.content, { queries: [] });
}

// ─── 7. OPENAI KEY HEALTH CHECK ─────────────────────────────────────────────
// Tiny test call so the frontend can verify the key works before relying on it.

export async function testApiKey() {
  if (!process.env.OPENAI_API_KEY) {
    return { ok: false, error: 'OPENAI_API_KEY not set' };
  }
  try {
    const start = Date.now();
    const completion = await getClient().chat.completions.create({
      model: MODEL(),
      max_tokens: 5,
      messages: [{ role: 'user', content: 'Reply with one word: OK' }],
    });
    const latency = Date.now() - start;
    const reply = completion.choices[0]?.message?.content || '';
    return {
      ok: true,
      model: MODEL(),
      latencyMs: latency,
      reply: reply.slice(0, 50),
      usage: completion.usage,
    };
  } catch (err) {
    return {
      ok: false,
      error: err.message,
      hint: err.status === 401 ? 'Invalid API key — get a new one at platform.openai.com/api-keys'
          : err.status === 429 ? 'Rate limited or out of credits — check platform.openai.com/settings/organization/billing'
          : err.status === 404 ? `Model "${MODEL()}" not found — set OPENAI_MODEL to gpt-4o-mini`
          : 'Check the error message; visit /api/diag for env status',
    };
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Robust JSON parser — gpt-4o-mini occasionally wraps JSON in markdown code
// fences despite response_format: json_object. This handles both cases.
function safeJsonParse(text, fallback = {}) {
  if (!text) return fallback;
  // Strip markdown code fences if present
  let cleaned = text.trim();
  cleaned = cleaned.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '');
  try {
    return JSON.parse(cleaned);
  } catch (err) {
    // Try to extract first {...} block as last resort
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    console.error('AI JSON parse failed:', err.message, 'Raw:', text.slice(0, 200));
    return fallback;
  }
}

// Strip chart datasets — LLM only needs summary numbers and table rows.
function compactReport(report) {
  return {
    title: report.title,
    subtitle: report.subtitle,
    dateRange: report.dateRange,
    scorecards: report.scorecards,
    tables: (report.sections || [])
      .filter((s) => s.type === 'table')
      .map((s) => ({
        title: s.title,
        rows: s.rows.slice(0, 20),
      })),
  };
}
