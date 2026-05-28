// src/reports/content-gaps.js
// Find queries with strong impression demand where you rank poorly.
// These are content/SEO opportunities the AI clusterer can group into topics.

import { comparisonRange } from '../gsc-client.js';

export async function contentGaps(gsc, { days = 28, minImpressions = 500, minPosition = 8 } = {}) {
  const range = comparisonRange(days);
  const rows = await gsc.query({
    startDate: range.current.startDate, endDate: range.current.endDate,
    dimensions: ['query'], rowLimit: 5000,
  });

  const gaps = rows
    .filter((r) => r.impressions >= minImpressions && r.position >= minPosition)
    .map((r) => ({
      query: r.keys[0],
      impressions: r.impressions,
      clicks: r.clicks,
      ctr: r.ctr,
      position: r.position,
    }))
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 100);

  const totalDemand = gaps.reduce((s, r) => s + r.impressions, 0);

  return {
    eyebrow: 'CONTENT OPPORTUNITIES',
    title: 'Content Gap Finder',
    subtitle: 'High-impression queries where you rank poorly — content and SEO opportunities',
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    scorecards: [
      { label: 'Gap queries found', value: gaps.length.toLocaleString() },
      { label: 'Total impression demand', value: totalDemand.toLocaleString() },
      { label: 'Min impressions', value: minImpressions.toLocaleString() },
      { label: 'Min position considered', value: minPosition.toString() },
    ],
    sections: [
      { type: 'note', text: 'Use "AI: Cluster Into Topics" below to group these queries into content briefs you can hand to writers.' },
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 gap queries — impressions',
        data: { labels: gaps.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Impressions', values: gaps.slice(0, 15).map((r) => r.impressions), color: '#f1c349' }] } },
      { type: 'table', title: 'All gap queries',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'ctr', label: 'CTR', format: 'pct' },
          { key: 'position', label: 'Position', format: 'position' },
        ], rows: gaps },
    ],
    aiActions: ['clusterQueries'],
    rawData: gaps.slice(0, 40),
  };
}
