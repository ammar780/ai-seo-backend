// src/reports/top-queries.js
import { comparisonRange, pctDelta } from '../gsc-client.js';

export async function topQueries(gsc, { days = 28, limit = 50, brand = null } = {}) {
  const range = comparisonRange(days);
  const filters = brand ? [{ dimension: 'query', operator: 'notContains', expression: brand }] : [];
  const [current, previous] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['query'], filters, rowLimit: limit }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['query'], filters, rowLimit: 5000 }),
  ]);
  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));
  const rows = current.map((r) => {
    const prev = prevMap.get(r.keys[0]) || { clicks: 0, impressions: 0, position: null };
    return {
      query: r.keys[0], clicks: r.clicks, prevClicks: prev.clicks,
      clicksDelta: pctDelta(r.clicks, prev.clicks),
      impressions: r.impressions, ctr: r.ctr, position: r.position,
    };
  });
  return {
    eyebrow: 'KEYWORD INTELLIGENCE',
    title: brand ? 'Top Non-Brand Queries' : 'Top Queries',
    subtitle: `${days}-day period · top ${limit} by clicks` + (brand ? ` · excluding "${brand}"` : ''),
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    sections: [
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 queries — clicks',
        data: { labels: rows.slice(0, 15).map((r) => r.query),
          series: [
            { name: 'Current period', values: rows.slice(0, 15).map((r) => r.clicks), color: '#f1c349' },
            { name: 'Prior period', values: rows.slice(0, 15).map((r) => r.prevClicks), color: '#3a3a42' },
          ] } },
      { type: 'table', title: `All ${rows.length} queries`,
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'clicksDelta', label: 'Δ Clicks', format: 'delta' },
          { key: 'impressions', label: 'Impr.', format: 'number' },
          { key: 'ctr', label: 'CTR', format: 'pct' },
          { key: 'position', label: 'Position', format: 'position' },
        ], rows },
    ],
  };
}
