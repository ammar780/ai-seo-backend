// src/reports/content-gaps.js
//
// Finds queries with strong impression demand where you rank on PAGE 2 or
// later (position 11+). These are content/SEO opportunities, distinct from
// CTR opportunities (page-1 queries with bad CTR).
//
// Rationale:
// - Position 11-20 = "near miss" page-2 rankings. Often fixable with on-page
//   improvements, internal linking, and freshness.
// - Position 21+ = real content gap. May need a new page, deeper content,
//   or topical authority building.
// - High impressions on these queries = Google sees you as relevant, you just
//   aren't winning the click yet.

import { comparisonRange } from '../gsc-client.js';

export async function contentGaps(gsc, {
  days = 28,
  minImpressions = 300,    // Lower than CTR-opps because page-2+ queries earn fewer impressions
  minPosition = 11,        // Page 2+ only (was 8 in v1 — that overlapped with CTR opps)
  maxPosition = 50,        // Beyond position 50, Google doesn't really show you
} = {}) {
  const range = comparisonRange(days);
  const rows = await gsc.query({
    startDate: range.current.startDate, endDate: range.current.endDate,
    dimensions: ['query'], rowLimit: 5000,
  });

  const gaps = rows
    .filter((r) =>
      r.impressions >= minImpressions &&
      r.position >= minPosition &&
      r.position <= maxPosition
    )
    .map((r) => {
      // Tier the opportunity by how achievable position 1-10 is from current rank
      let tier;
      if (r.position <= 15) tier = 'Near-miss';     // 11-15: usually fixable on-page
      else if (r.position <= 30) tier = 'Stretch';  // 16-30: needs content + links
      else tier = 'Long-term';                       // 31+: probably needs new page

      // Conservative expected lift: bringing them to position 8-10 (page 1 bottom)
      // would roughly 10-20× the clicks for queries currently at 20+.
      const targetCtr = 0.015; // ~position 9-10 CTR
      const realisticClicks = Math.round(targetCtr * r.impressions * 0.6); // 60% of theoretical to be conservative

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

  const totalDemand = gaps.reduce((s, r) => s + r.impressions, 0);
  const totalRealistic = gaps.reduce((s, r) => s + r.realisticClicks, 0);
  const nearMiss = gaps.filter((g) => g.tier === 'Near-miss').length;

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
        text: 'Near-miss queries (pos 11-15) are highest priority — typically fixable with title/H1 tweaks, internal linking from high-authority pages, and content freshness. Stretch queries (16-30) usually need content depth improvements. Long-term queries (31+) often need new dedicated pages or topical authority. Click "AI: Cluster Into Topics" below to group queries into actionable content briefs.' },
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 gap queries — impression demand',
        data: { labels: gaps.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Impressions', values: gaps.slice(0, 15).map((r) => r.impressions), color: '#f1c349' }] } },
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
