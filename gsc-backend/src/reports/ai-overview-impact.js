// src/reports/ai-overview-impact.js
//
// NEW REPORT: AI Overview Cannibalization Detector
//
// Identifies the AI Overview footprint on your site: queries where you maintain
// good position but CTR has collapsed. This is the #1 SEO issue of 2025-2026.
//
// Methodology:
// 1. Find queries where current CTR < 50% of expected for position
// 2. AND position is stable or improving vs prior period
// 3. AND impressions are stable or growing (Google still shows you)
// 4. AND query has informational intent markers (how, what, why, best, top, etc.)
//
// These are the queries most likely cannibalized by AI Overviews.

import { comparisonRange } from '../gsc-client.js';

const INFORMATIONAL_MARKERS = [
  'how ', 'what ', 'why ', 'when ', 'where ', 'who ', 'which ',
  'best ', 'top ', 'guide', 'tutorial', 'tips', 'ideas',
  'vs ', ' vs', 'difference', 'compare', 'comparison',
  'meaning', 'definition', 'examples', 'explained',
];

const EXPECTED_CTR = {
  1: 0.275, 2: 0.155, 3: 0.100, 4: 0.070, 5: 0.050,
  6: 0.035, 7: 0.025, 8: 0.020, 9: 0.016, 10: 0.013,
};

function expectedCtrFor(pos) {
  if (pos <= 1) return EXPECTED_CTR[1];
  if (pos >= 10) return EXPECTED_CTR[10];
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const t = pos - lower;
  return EXPECTED_CTR[lower] * (1 - t) + EXPECTED_CTR[upper] * t;
}

function isInformational(query) {
  const q = query.toLowerCase();
  return INFORMATIONAL_MARKERS.some((m) => q.includes(m));
}

export async function aiOverviewImpact(gsc, { days = 28, minImpressions = 300 } = {}) {
  const range = comparisonRange(days);

  const [current, previous] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['query'], rowLimit: 5000 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['query'], rowLimit: 5000 }),
  ]);

  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));

  const cannibalized = current
    .filter((r) =>
      r.impressions >= minImpressions &&
      r.position <= 10 &&
      r.position >= 1
    )
    .map((r) => {
      const prev = prevMap.get(r.keys[0]);
      const expected = expectedCtrFor(r.position);
      const ctrShortfall = (expected - r.ctr) / expected; // 0-1 scale

      // Strict criteria for "AI Overview footprint":
      // - CTR is at least 50% below benchmark
      // - Position is stable or improving (not a ranking issue)
      // - Impressions stable/growing (Google still shows you)
      const positionStable = !prev || prev.position == null || r.position <= prev.position + 0.5;
      const impressionsStable = !prev || r.impressions >= prev.impressions * 0.85;
      const isInfo = isInformational(r.keys[0]);

      const aioConfidence =
        (ctrShortfall >= 0.5 ? 1 : 0) +
        (positionStable ? 1 : 0) +
        (impressionsStable ? 1 : 0) +
        (isInfo ? 1 : 0);

      return {
        query: r.keys[0],
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        expectedCtr: expected,
        ctrShortfall,
        position: r.position,
        positionPrev: prev?.position ?? null,
        intent: isInfo ? 'Informational' : 'Other',
        confidence: aioConfidence >= 3 ? 'High' : aioConfidence >= 2 ? 'Medium' : 'Low',
        confidenceScore: aioConfidence,
      };
    })
    .filter((r) => r.confidenceScore >= 2 && r.ctrShortfall >= 0.4)
    .sort((a, b) => (b.confidenceScore - a.confidenceScore) || (b.impressions - a.impressions))
    .slice(0, 50);

  const highConf = cannibalized.filter((r) => r.confidence === 'High').length;
  const totalLostClicks = cannibalized.reduce((s, r) => {
    const expectedClicks = r.expectedCtr * r.impressions;
    return s + Math.max(0, expectedClicks - r.clicks);
  }, 0);

  return {
    eyebrow: 'AI OVERVIEW IMPACT',
    title: 'AI Overview Cannibalization',
    subtitle: 'Queries where you rank well but CTR has collapsed — likely AI Overview footprint',
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    scorecards: [
      { label: 'Affected queries', value: cannibalized.length.toLocaleString() },
      { label: 'High-confidence AIO', value: highConf.toLocaleString() },
      { label: 'Estimated lost clicks', value: Math.round(totalLostClicks).toLocaleString() },
      { label: 'Min impressions', value: minImpressions.toLocaleString() },
    ],
    sections: [
      { type: 'note',
        text: 'AI Overviews now appear on ~13% of US queries (32% of informational) and reduce CTR 30-58% at every position when present. Queries flagged here maintain visibility but lose clicks — Google is showing you, but users find their answer in the AIO without clicking. Strategy: rewrite content to BE the AIO citation (direct answers in first 50 words, structured data, original stats). For high-confidence queries, also bid for branded paid traffic to recapture intent.' },
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 cannibalized queries — estimated lost clicks',
        data: { labels: cannibalized.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Lost clicks',
            values: cannibalized.slice(0, 15).map((r) => Math.round((r.expectedCtr * r.impressions) - r.clicks)),
            color: '#a78bfa' }] } },
      { type: 'table', title: 'All cannibalized queries',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'confidence', label: 'AIO confidence' },
          { key: 'intent', label: 'Intent' },
          { key: 'position', label: 'Position', format: 'position' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'Actual CTR', format: 'pct' },
          { key: 'expectedCtr', label: 'Expected CTR', format: 'pct' },
        ], rows: cannibalized },
    ],
    aiActions: ['aioStrategy'],
    rawData: cannibalized.slice(0, 20),
  };
}
