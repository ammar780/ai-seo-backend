// src/reports/site-health.js
//
// Site Health Check — runs first to give the user a clear picture of where
// they stand and what to do next. Especially useful for small/new sites
// where most optimization reports return "0 results".
//
// Calculates: total queries, page-1 vs page-2+ split, total traffic,
// query depth, recommended first actions.

import { comparisonRange } from '../gsc-client.js';

export async function siteHealth(gsc, { days = 90 } = {}) {
  const range = comparisonRange(days);
  const [queries, pages, total] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['query'], rowLimit: 5000 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['page'], rowLimit: 5000 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: [], rowLimit: 1 }),
  ]);

  const totals = total[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };

  // Count queries by position bucket
  const buckets = { p0: 0, p1_3: 0, p4_10: 0, p11_20: 0, p21_50: 0, p51plus: 0 };
  for (const r of queries) {
    const p = r.position;
    if (p < 1) buckets.p0++;
    else if (p <= 3) buckets.p1_3++;
    else if (p <= 10) buckets.p4_10++;
    else if (p <= 20) buckets.p11_20++;
    else if (p <= 50) buckets.p21_50++;
    else buckets.p51plus++;
  }

  const totalQueries = queries.length;
  const totalPages = pages.length;
  const page1Queries = buckets.p0 + buckets.p1_3 + buckets.p4_10;
  const queriesWithVolume = queries.filter((r) => r.impressions >= 50).length;

  // Site size classification (for tailored advice)
  let siteSize;
  if (totals.clicks < 100) siteSize = 'New / very small';
  else if (totals.clicks < 1000) siteSize = 'Small';
  else if (totals.clicks < 10000) siteSize = 'Medium';
  else if (totals.clicks < 100000) siteSize = 'Large';
  else siteSize = 'Enterprise';

  // Generate prioritized action plan
  const actions = [];
  if (totalQueries < 50) {
    actions.push({ priority: 1, action: 'Publish more content — Google has indexed too few queries for you', why: 'GSC tracks only what Google sees you for. Low query count = low indexing or thin content.' });
  }
  if (page1Queries < 10) {
    actions.push({ priority: 1, action: 'Focus on Content Gap Finder + AI Cluster to write articles for near-miss queries', why: 'Page-2 rankings convert to page-1 with on-page improvements much faster than ranking new queries from scratch.' });
  } else if (page1Queries < 50) {
    actions.push({ priority: 2, action: 'Optimize the page-1 rankings you have — use CTR Opportunities + AI Title Rewrites', why: 'Improving CTR on existing rankings is the fastest traffic lift available.' });
  }
  if (buckets.p11_20 > page1Queries * 2) {
    actions.push({ priority: 1, action: 'You have many page-2 (pos 11-20) queries — biggest opportunity is pushing them to page 1', why: 'These are "near-miss" queries Google already finds relevant. Title tweaks + internal links + freshness usually do it.' });
  }
  if (totalPages < 20) {
    actions.push({ priority: 2, action: 'Build more pages — only ' + totalPages + ' pages get Google traffic', why: 'Site authority scales with topic breadth. 50+ indexed pages is a minimum for most niches.' });
  }
  actions.push({ priority: 3, action: 'Add Author bio with credentials + Author schema on every page', why: 'E-E-A-T is critical for YMYL content (especially supplements/health). This is the #1 ranking signal Google rewards in 2026.' });
  actions.push({ priority: 3, action: 'Add FAQ schema to all informational pages, Product schema to product pages', why: 'Schema dramatically increases your chance of being cited inside AI Overviews.' });

  // Sort actions: priority ascending, then keep order
  actions.sort((a, b) => a.priority - b.priority);

  return {
    eyebrow: 'SITE HEALTH', title: 'Site Health Check',
    subtitle: 'Snapshot of your overall SEO position and what to do next',
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    scorecards: [
      { label: 'Site size', value: siteSize },
      { label: 'Total queries', value: totalQueries.toLocaleString() },
      { label: 'Page-1 queries', value: page1Queries.toLocaleString() },
      { label: 'Total clicks', value: totals.clicks.toLocaleString() },
    ],
    sections: [
      { type: 'note',
        text: `Your site is classified as "${siteSize}" based on ${totals.clicks.toLocaleString()} clicks over the last ${days} days. The actions below are tailored to your size — work them in priority order.` },
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Where your queries rank',
        data: { labels: ['Pos 0 (snippet)', 'Pos 1-3', 'Pos 4-10', 'Pos 11-20', 'Pos 21-50', 'Pos 51+'],
          series: [{ name: 'Queries', values: [buckets.p0, buckets.p1_3, buckets.p4_10, buckets.p11_20, buckets.p21_50, buckets.p51plus], color: '#f1c349' }] } },
      { type: 'table', title: 'Your prioritized action plan',
        subtitle: 'Work top to bottom. Each action links to the right report.',
        columns: [
          { key: 'priority', label: 'P' },
          { key: 'action', label: 'Action' },
          { key: 'why', label: 'Why' },
        ], rows: actions },
      { type: 'table', title: 'Quick stats',
        columns: [
          { key: 'metric', label: 'Metric' },
          { key: 'value', label: 'Value' },
        ], rows: [
          { metric: 'Total queries Google sees you for', value: totalQueries.toLocaleString() },
          { metric: 'Queries with ≥50 impressions (meaningful)', value: queriesWithVolume.toLocaleString() },
          { metric: 'Page-1 queries (pos 1-10)', value: page1Queries.toLocaleString() },
          { metric: 'Page-2 queries (pos 11-20) — biggest opportunity', value: buckets.p11_20.toLocaleString() },
          { metric: 'Total pages getting traffic', value: totalPages.toLocaleString() },
          { metric: 'Total clicks in period', value: totals.clicks.toLocaleString() },
          { metric: 'Total impressions', value: totals.impressions.toLocaleString() },
          { metric: 'Average CTR', value: (totals.ctr * 100).toFixed(2) + '%' },
          { metric: 'Average position', value: totals.position ? totals.position.toFixed(1) : '—' },
        ] },
    ],
    aiActions: [],
    rawData: { siteSize, buckets, totalQueries, page1Queries, actions },
  };
}
