// src/reports/countries.js
import { comparisonRange, pctDelta } from '../gsc-client.js';

export async function countries(gsc, { days = 28, limit = 25 } = {}) {
  const range = comparisonRange(days);
  const [current, previous] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['country'], rowLimit: limit }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['country'], rowLimit: 1000 }),
  ]);
  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));
  const total = current.reduce((s, r) => s + r.clicks, 0) || 1;
  const rows = current.map((r) => {
    const prev = prevMap.get(r.keys[0]) || {};
    return {
      country: r.keys[0].toUpperCase(), clicks: r.clicks, share: r.clicks / total,
      clicksDelta: pctDelta(r.clicks, prev.clicks || 0),
      impressions: r.impressions, ctr: r.ctr, position: r.position,
    };
  });
  return {
    eyebrow: 'GEOGRAPHIC BREAKDOWN', title: 'Performance by Country',
    subtitle: `${days}-day period · top ${limit} countries`,
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    sections: [
      { type: 'chart', chartType: 'bar', title: 'Top 10 countries — clicks',
        data: { labels: rows.slice(0, 10).map((r) => r.country),
          series: [{ name: 'Clicks', values: rows.slice(0, 10).map((r) => r.clicks), color: '#f1c349' }] } },
      { type: 'table', title: 'All countries',
        columns: [
          { key: 'country', label: 'Country' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'share', label: 'Share', format: 'pct' },
          { key: 'clicksDelta', label: 'Δ vs prior', format: 'delta' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'CTR', format: 'pct' },
          { key: 'position', label: 'Position', format: 'position' },
        ], rows },
    ],
  };
}
