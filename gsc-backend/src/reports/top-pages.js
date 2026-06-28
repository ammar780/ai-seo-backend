// src/reports/top-pages.js
import { comparisonRange, pctDelta } from '../gsc-client.js';

export async function topPages(gsc, { days = 28, limit = 50 } = {}) {
  const range = comparisonRange(days);
  const [current, previous] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['page'], rowLimit: limit }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['page'], rowLimit: 5000 }),
  ]);
  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));
  const rows = current.map((r) => {
    const prev = prevMap.get(r.keys[0]) || { clicks: 0 };
    return {
      page: shortenUrl(r.keys[0]), fullUrl: r.keys[0], clicks: r.clicks,
      clicksDelta: pctDelta(r.clicks, prev.clicks),
      impressions: r.impressions, ctr: r.ctr, position: r.position,
    };
  });
  return {
    eyebrow: 'LANDING PAGES', title: 'Top Landing Pages',
    subtitle: `${days}-day period · top ${limit} pages by clicks`,
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    sections: [
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 pages — clicks',
        data: { labels: rows.slice(0, 15).map((r) => r.page),
          series: [{ name: 'Clicks', values: rows.slice(0, 15).map((r) => r.clicks), color: '#f1c349' }] } },
      { type: 'table', title: 'All pages',
        columns: [
          { key: 'page', label: 'Page', format: 'url' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'clicksDelta', label: 'Δ Clicks', format: 'delta' },
          { key: 'impressions', label: 'Impr.', format: 'number' },
          { key: 'ctr', label: 'CTR', format: 'pct' },
          { key: 'position', label: 'Position', format: 'position' },
        ], rows },
    ],
  };
}

function shortenUrl(u) { try { return new URL(u).pathname || '/'; } catch { return u; } }
