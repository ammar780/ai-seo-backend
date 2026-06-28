// src/reports/content-gaps.js
//
// Finds queries with strong impression demand where you rank on PAGE 2 or
// later (position 11+). These are content/SEO opportunities, distinct from
// CTR opportunities (page-1 queries with bad CTR).

import { comparisonRange } from '../gsc-client.js';

export async function contentGaps(gsc, {
  days = 28,
  minImpressions = 300,
  minPosition = 11,
  maxPosition = 50,
} = {}) {
  const range = comparisonRange(days);
  const rows = await gsc.query({
    startDate: range.current.startDate, endDate: range.current.endDate,
    dimensions: ['query'], rowLimit: 5000,
  });

  // ADAPTIVE THRESHOLD: if no queries meet the threshold for the user's site
  // size, automatically retry with a lower threshold. This prevents small
  // sites from seeing "0 results" with no explanation.
  let effectiveMinImpressions = minImpressions;
  let gaps = filterGaps(rows, effectiveMinImpressions, minPosition, maxPosition);

  // If first pass returns nothing, progressively lower threshold
  if (gaps.length === 0 && minImpressions > 50) {
    for (const tryMin of [100, 50, 25, 10, 5]) {
      effectiveMinImpressions = tryMin;
      gaps = filterGaps(rows, tryMin, minPosition, maxPosition);
      if (gaps.length > 0) break;
    }
  }

  const totalDemand = gaps.reduce((s, r) => s + r.impressions, 0);
  const totalRealistic = gaps.reduce((s, r) => s + r.realisticClicks, 0);
  const nearMiss = gaps.filter((g) => g.tier === 'Near-miss').length;

  const adaptedNote = effectiveMinImpressions < minImpressions
    ? ` (auto-lowered min impressions from ${minImpressions} to ${effectiveMinImpressions} — site has lower query volume)`
    : '';

  return {
    eyebrow: 'CONTENT OPPORTUNITIES',
    title: 'Content Gap Finder',
    subtitle: 'Page-2+ queries with strong impression demand — content and on-page SEO opportunities',
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    scorecards: [
      { label: 'Total gap queries', value: gaps.length.toLocaleString() },
      { label: 'Near-miss (pos 11-15)', value: nearMiss.toLocaleString() },
      { label: 'Total impression demand', value: totalDemand.toLocaleString() },
      { label: 'Realistic click upside', value: totalRealistic.toLocaleString() },
    ],
    sections: [
      { type: 'note',
        text: `Near-miss queries (pos 11-15) are highest priority — typically fixable with title/H1 tweaks, internal linking from high-authority pages, and content freshness. Stretch queries (16-30) usually need content depth improvements. Long-term queries (31+) often need new dedicated pages or topical authority. Click "AI: Cluster Into Topics" below to group queries into actionable content briefs.${adaptedNote}` },
      ...(gaps.length > 0 ? [{
        type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 gap queries — impression demand',
        data: { labels: gaps.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Impressions', values: gaps.slice(0, 15).map((r) => r.impressions), color: '#f1c349' }] }
      }] : [{
        type: 'note',
        text: '⚠ No content gaps found in this period. This typically means: (a) the site is too new or too small to have page-2+ queries with meaningful impressions, (b) all major queries are already ranking on page 1, or (c) the date window is too narrow. Try a wider date range (60-90 days) or check the Top Queries report to see what you ARE ranking for.',
      }]),
      { type: 'table', title: 'All gap queries',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'tier', label: 'Tier' },
          { key: 'position', label: 'Position', format: 'position' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'ctr', label: 'CTR', format: 'pct' },
          { key: 'realisticClicks', label: 'Upside if pos 8-10', format: 'number' },
        ], rows: gaps },
    ],
    aiActions: ['clusterQueries'],
    rawData: gaps.slice(0, 40),
  };
}

function filterGaps(rows, minImpressions, minPosition, maxPosition) {
  return rows
    .filter((r) =>
      r.impressions >= minImpressions &&
      r.position >= minPosition &&
      r.position <= maxPosition
    )
    .map((r) => {
      let tier;
      if (r.position <= 15) tier = 'Near-miss';
      else if (r.position <= 30) tier = 'Stretch';
      else tier = 'Long-term';

      const targetCtr = 0.015;
      const realisticClicks = Math.round(targetCtr * r.impressions * 0.6);

      return {
        query: r.keys[0],
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        position: r.position,
        tier,
        realisticClicks,
      };
    })
    .sort((a, b) => b.impressions - a.impressions)
    .slice(0, 100);
}
