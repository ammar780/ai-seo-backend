// src/ai/openai-client.js
// All OpenAI-powered SEO features. Each function takes structured GSC data
// and returns AI-generated insights as JSON or markdown.

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

export function isAIConfigured() {
  return Boolean(process.env.OPENAI_API_KEY);
}

// ─── 1. EXECUTIVE SUMMARY ───────────────────────────────────────────────────
// Takes any report object and writes a 3-paragraph executive summary.

export async function summarizeReport(report) {
  const compact = compactReport(report);
  const system = `You are a senior SEO consultant analyzing a Google Search Console report. Your job is to write a concise, no-fluff executive summary that a business owner can read in 60 seconds.

Format your response as exactly 3 short paragraphs:
1. **What's happening** (the headline finding — 2-3 sentences)
2. **Why it matters** (impact and context — 2-3 sentences)
3. **What to do** (1-3 specific action items as a tight list)

Be direct, specific, and tie observations to numbers. Avoid hedging language ("might", "could be"). Don't repeat the data verbatim — interpret it.`;

  const user = `Here is the SEO report. Site: ${report.site}. Period: ${report.dateRange}.

${JSON.stringify(compact, null, 2)}

Write the executive summary now.`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.3,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return { summary: completion.choices[0]?.message?.content || '' };
}

// ─── 2. TITLE & META REWRITER ───────────────────────────────────────────────
// For CTR opportunity queries, generate 3 optimized title + meta options.

export async function rewriteTitles(opportunities, siteContext = '') {
  const queries = opportunities.slice(0, 10).map((o) => ({
    query: o.query,
    position: o.position,
    impressions: o.impressions,
    currentCtr: o.ctr,
    expectedCtr: o.expectedCtr,
    upside: o.potentialClicks,
  }));

  const system = `You are an SEO copywriter specializing in high-CTR titles and meta descriptions.

For each query below, write 3 distinct title + meta description options that:
- Match search intent precisely
- Include the primary keyword naturally
- Title: 50–60 characters, compelling, specific
- Meta description: 140–155 characters, includes a value prop or CTA
- Different angles between variants (curiosity, specificity, urgency, social proof)

Return STRICT JSON with this shape:
{
  "results": [
    {
      "query": "...",
      "rationale": "1 sentence on what's holding back CTR",
      "variants": [
        { "title": "...", "meta": "...", "angle": "..." },
        { "title": "...", "meta": "...", "angle": "..." },
        { "title": "...", "meta": "...", "angle": "..." }
      ]
    }
  ]
}`;

  const user = `${siteContext ? `Site context: ${siteContext}\n\n` : ''}Queries needing better CTR:\n\n${JSON.stringify(queries, null, 2)}`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.7,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return JSON.parse(completion.choices[0]?.message?.content || '{"results":[]}');
}

// ─── 3. DROP DIAGNOSIS ──────────────────────────────────────────────────────
// Takes pages/queries that lost traffic and proposes hypotheses.

export async function diagnoseDrops(losersData) {
  const system = `You are an SEO analyst diagnosing organic traffic drops. Given pages and queries that lost clicks, propose likely causes and investigation steps.

For each significant drop, consider:
- Algorithm updates (look up recent Google updates and SERP volatility)
- Position changes (ranking drop = visibility loss)
- SERP feature creep (AI Overviews, featured snippets, shopping packs)
- Seasonality
- Cannibalization or canonical issues
- Technical (indexation, page changes, redirects)
- Intent shift

Return STRICT JSON:
{
  "topLevelDiagnosis": "1-2 sentence overall pattern",
  "items": [
    {
      "target": "page URL or query",
      "metric": "clicks dropped from X to Y (-Z%)",
      "hypotheses": [
        { "cause": "...", "likelihood": "high|medium|low", "investigation": "specific thing to check" }
      ]
    }
  ],
  "priorityActions": ["...", "...", "..."]
}`;

  const user = `Losers from Google Search Console:\n\n${JSON.stringify(losersData, null, 2)}`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return JSON.parse(completion.choices[0]?.message?.content || '{}');
}

// ─── 4. QUERY CLUSTERER ─────────────────────────────────────────────────────
// Groups gap queries into content topic clusters with article briefs.

export async function clusterQueries(gaps, siteContext = '') {
  const queries = gaps.slice(0, 40).map((g) => ({
    query: g.query, impressions: g.impressions, position: g.position,
  }));

  const system = `You are a content strategist. Given underperforming queries from Google Search Console, group them into thematic clusters that each could become one article or landing page.

For each cluster, write a brief that includes:
- A primary keyword (highest-volume query in cluster)
- 2-5 secondary keywords from the cluster
- Suggested page title
- Search intent (informational, commercial, transactional, navigational)
- Estimated content type (blog post, product page, comparison, guide, etc.)
- A one-line rationale for what this article should cover

Return STRICT JSON:
{
  "clusters": [
    {
      "topic": "Short cluster name",
      "intent": "informational|commercial|transactional|navigational",
      "contentType": "...",
      "totalImpressions": 0,
      "primaryKeyword": "...",
      "secondaryKeywords": ["...", "..."],
      "suggestedTitle": "...",
      "brief": "1-2 sentence content brief"
    }
  ]
}

Aim for 4–8 clusters. Skip queries that are too brand-specific or too thin.`;

  const user = `${siteContext ? `Site context: ${siteContext}\n\n` : ''}Underperforming queries:\n\n${JSON.stringify(queries, null, 2)}`;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.4,
    response_format: { type: 'json_object' },
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
  });

  return JSON.parse(completion.choices[0]?.message?.content || '{"clusters":[]}');
}

// ─── 5. FREE-FORM CHAT ──────────────────────────────────────────────────────
// Q&A with optional report context.

export async function chat(question, contextReport = null) {
  const compact = contextReport ? compactReport(contextReport) : null;

  const system = `You are an experienced SEO consultant. Answer the user's question directly and concretely. Cite specific numbers from the provided report when relevant. If the data doesn't support an answer, say so plainly. Use short paragraphs and tight lists. Avoid jargon and avoid hedging.`;

  const userContent = compact
    ? `Report context:\n${JSON.stringify(compact, null, 2)}\n\nQuestion: ${question}`
    : question;

  const completion = await getClient().chat.completions.create({
    model: MODEL(),
    temperature: 0.4,
    messages: [{ role: 'system', content: system }, { role: 'user', content: userContent }],
  });

  return { answer: completion.choices[0]?.message?.content || '' };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

// Strip down a report for the LLM context — we don't need chart datasets,
// just the summary numbers, deltas, and table rows.
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
        // Cap row count to control token cost
        rows: s.rows.slice(0, 20),
      })),
  };
}
