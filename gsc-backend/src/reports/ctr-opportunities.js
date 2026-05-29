// src/reports/ctr-opportunities.js
//
// Finds queries with high impression volume but below-benchmark CTR for their
// position — these are candidates for title and meta description rewrites.
//
// 2026 BENCHMARK NOTES (verified May 2026):
// CTR has dropped at every position vs the pre-AI-Overview baseline. We use
// CONSERVATIVE benchmarks here that approximate Backlinko (2024) + AI Overview
// adjusted blended numbers. These reflect realistic CTRs for sites WITHOUT
// being cited inside an AI Overview. Source synthesis from First Page Sage 2026,
// Backlinko 4M-result study, Ahrefs Feb 2026 AIO study, Seer Interactive 2026.
//
// We intentionally use the LOWER side of published benchmarks to:
//   1) Avoid over-promising upside that AI Overview presence will eat into
//   2) Surface only the clearest opportunities (high signal, low noise)
//   3) Avoid recommending title rewrites for queries already near benchmark

import { comparisonRange } from '../gsc-client.js';

// CTR by integer position. Linearly interpolated for fractional positions.
// These are the "achievable CTR" floor: realistic targets, not best-case.
const EXPECTED_CTR = {
  1: 0.275,   // Position 1: 27.5% (Backlinko ~27.6%, First Page Sage 39.8%, blended for AIO presence)
  2: 0.155,   // Position 2: 15.5%
  3: 0.100,   // Position 3: 10.0%
  4: 0.070,   // Position 4: 7.0%
  5: 0.050,   // Position 5: 5.0%
  6: 0.035,   // Position 6: 3.5%
  7: 0.025,   // Position 7: 2.5%
  8: 0.020,   // Position 8: 2.0%
  9: 0.016,   // Position 9: 1.6%
  10: 0.013,  // Position 10: 1.3%
};

// Queries within this ratio of benchmark are NOT flagged. Avoids recommending
// rewrites for queries already near benchmark (diminishing returns).
const UNDERPERFORMANCE_THRESHOLD = 0.70;

// Minimum potential click upside to surface as an opportunity.
const MIN_UPSIDE_CLICKS = 8;

function expectedCtrFor(pos) {
  if (pos <= 1) return EXPECTED_CTR[1];
  if (pos >= 10) return EXPECTED_CTR[10];
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const t = pos - lower;
  return EXPECTED_CTR[lower] * (1 - t) + EXPECTED_CTR[upper] * t;
}

export async function ctrOpportunities(gsc, {
  days = 28,
  minImpressions = 200,
  maxPosition = 10,   // Page 1 only — position 11+ is content gap territory
} = {}) {
  const range = comparisonRange(days);
  const rows = await gsc.query({
    startDate: range.current.startDate, endDate: range.current.endDate,
    dimensions: ['query'], rowLimit: 5000,
  });

  const opportunities = rows
    .filter((r) => r.impressions >= minImpressions && r.position <= maxPosition && r.position >= 1)
    .map((r) => {
      const expected = expectedCtrFor(r.position);
      const underperformanceRatio = r.ctr / expected;
      if (underperformanceRatio >= UNDERPERFORMANCE_THRESHOLD) return null;

      // Conservative upside: assume rewrite captures HALF the CTR gap, not all.
      // Mirrors real-world A/B test outcomes for title changes (typical 5-15% lift).
      const gap = expected - r.ctr;
      const realisticUpsidePct = gap * 0.5;
      const potentialClicks = Math.max(0, Math.round(realisticUpsidePct * r.impressions));

      return {
        query: r.keys[0],
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        expectedCtr: expected,
        ctrGap: gap,
        position: r.position,
        potentialClicks,
        underperformanceRatio,
      };
    })
    .filter((r) => r && r.potentialClicks >= MIN_UPSIDE_CLICKS)
    .sort((a, b) => b.potentialClicks - a.potentialClicks)
    .slice(0, 50);

  const totalUpside = opportunities.reduce((s, r) => s + r.potentialClicks, 0);

  return {
    eyebrow: 'CTR OPPORTUNITIES', title: 'Title & Meta Win Candidates',
    subtitle: 'Page-1 queries with high impressions but below-benchmark CTR — candidates for title and meta description rewrites',
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    scorecards: [
      { label: 'Opportunities found', value: opportunities.length.toLocaleString() },
      { label: 'Realistic upside / period', value: totalUpside.toLocaleString() + ' clicks' },
      { label: 'Min impressions', value: minImpressions.toLocaleString() },
      { label: 'Max position', value: maxPosition.toString() },
    ],
    sections: [
      { type: 'note',
        text: 'Benchmarks reflect 2026 post-AI-Overview CTR floors. Upside is conservative: 50% of the CTR gap × impressions, matching real A/B test outcomes. Queries already within 70% of benchmark are excluded. If an AI Overview consistently appears for these queries, the realistic upside is lower still — verify SERP appearance before rewriting. Click "AI: Rewrite Titles" below for optimized variants.' },
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 opportunities — realistic click upside',
        data: { labels: opportunities.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Potential clicks (50% of gap)', values: opportunities.slice(0, 15).map((r) => r.potentialClicks), color: '#f1c349' }] } },
      { type: 'table', title: 'All opportunities',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'position', label: 'Position', format: 'position' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'Actual CTR', format: 'pct' },
          { key: 'expectedCtr', label: 'Benchmark CTR', format: 'pct' },
          { key: 'clicks', label: 'Clicks now', format: 'number' },
          { key: 'potentialClicks', label: 'Realistic upside', format: 'number' },
        ], rows: opportunities },
    ],
    aiActions: ['titleRewrites'],
    rawData: opportunities.slice(0, 20),
  };
}
