// src/reports/ctr-opportunities.js
import { comparisonRange } from '../gsc-client.js';

const EXPECTED_CTR = { 1: 0.28, 2: 0.16, 3: 0.11, 4: 0.08, 5: 0.06, 6: 0.05, 7: 0.04, 8: 0.03, 9: 0.025, 10: 0.022 };

function expectedCtrFor(pos) {
  if (pos <= 1) return EXPECTED_CTR[1];
  if (pos >= 10) return EXPECTED_CTR[10];
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  const t = pos - lower;
  return EXPECTED_CTR[lower] * (1 - t) + EXPECTED_CTR[upper] * t;
}

export async function ctrOpportunities(gsc, { days = 28, minImpressions = 200, maxPosition = 10 } = {}) {
  const range = comparisonRange(days);
  const rows = await gsc.query({
    startDate: range.current.startDate, endDate: range.current.endDate,
    dimensions: ['query'], rowLimit: 5000,
  });
  const opportunities = rows
    .filter((r) => r.impressions >= minImpressions && r.position <= maxPosition)
    .map((r) => {
      const expected = expectedCtrFor(r.position);
      const gap = expected - r.ctr;
      const potentialClicks = Math.max(0, gap * r.impressions);
      return { query: r.keys[0], impressions: r.impressions, clicks: r.clicks,
        ctr: r.ctr, expectedCtr: expected, position: r.position, potentialClicks: Math.round(potentialClicks) };
    })
    .filter((r) => r.potentialClicks > 5)
    .sort((a, b) => b.potentialClicks - a.potentialClicks)
    .slice(0, 50);
  const totalUpside = opportunities.reduce((s, r) => s + r.potentialClicks, 0);
  return {
    eyebrow: 'CTR OPPORTUNITIES', title: 'Title & Meta Win Candidates',
    subtitle: 'Queries with high impressions but below-benchmark CTR for their position',
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    scorecards: [
      { label: 'Opportunities found', value: opportunities.length.toLocaleString() },
      { label: 'Potential clicks/period', value: totalUpside.toLocaleString() },
      { label: 'Min impressions threshold', value: minImpressions.toLocaleString() },
      { label: 'Max position considered', value: maxPosition.toString() },
    ],
    sections: [
      { type: 'note', text: 'Expected CTR uses industry benchmark midpoints by position. Click "AI: Rewrite Titles" below to generate optimized title + meta suggestions for the top candidates.' },
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 opportunities — potential upside',
        data: { labels: opportunities.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Potential clicks', values: opportunities.slice(0, 15).map((r) => r.potentialClicks), color: '#f1c349' }] } },
      { type: 'table', title: 'All opportunities',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'position', label: 'Position', format: 'position' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'Actual CTR', format: 'pct' },
          { key: 'expectedCtr', label: 'Expected CTR', format: 'pct' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'potentialClicks', label: 'Upside', format: 'number' },
        ], rows: opportunities },
    ],
    // AI hint: tells frontend that AI title-rewrite action is supported for this report
    aiActions: ['titleRewrites'],
    rawData: opportunities.slice(0, 20), // for AI rewriter
  };
}
