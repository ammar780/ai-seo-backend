// src/reports/overview.js
import { comparisonRange, pctDelta, fmtNum, fmtPct } from '../gsc-client.js';

export async function overview(gsc, { days = 28 } = {}) {
  const range = comparisonRange(days);
  const [dailyRows, currentTotal, previousTotal, topQ, topP] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['date'], rowLimit: 1000 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: [], rowLimit: 1 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: [], rowLimit: 1 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['query'], rowLimit: 25 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['page'], rowLimit: 25 }),
  ]);
  const cur = currentTotal[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const prev = previousTotal[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  return {
    eyebrow: 'PERFORMANCE OVERVIEW',
    title: 'Search Performance',
    subtitle: `${days}-day overview from Google Search Console`,
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate} (vs ${range.previous.startDate} → ${range.previous.endDate})`,
    scorecards: [
      { label: 'Clicks', value: fmtNum(cur.clicks), delta: pctDelta(cur.clicks, prev.clicks), deltaLabel: 'vs prior period' },
      { label: 'Impressions', value: fmtNum(cur.impressions), delta: pctDelta(cur.impressions, prev.impressions), deltaLabel: 'vs prior period' },
      { label: 'CTR', value: fmtPct(cur.ctr), delta: pctDelta(cur.ctr, prev.ctr), deltaLabel: 'vs prior period' },
      { label: 'Avg Position', value: cur.position ? cur.position.toFixed(1) : '—', delta: prev.position ? -pctDelta(cur.position, prev.position) : null, deltaLabel: 'lower is better' },
    ],
    sections: [
      { type: 'chart', chartType: 'line', title: 'Daily clicks & impressions',
        data: { labels: dailyRows.map((r) => r.keys[0]),
          series: [
            { name: 'Clicks', values: dailyRows.map((r) => r.clicks), color: '#f1c349', yAxis: 'left' },
            { name: 'Impressions', values: dailyRows.map((r) => r.impressions), color: '#9999a3', yAxis: 'right', dashed: true },
          ] } },
      { type: 'table', title: 'Top queries',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'CTR', format: 'pct' },
          { key: 'position', label: 'Position', format: 'position' },
        ],
        rows: topQ.map((r) => ({ query: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })) },
      { type: 'table', title: 'Top landing pages',
        columns: [
          { key: 'page', label: 'Page', format: 'url' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'CTR', format: 'pct' },
          { key: 'position', label: 'Position', format: 'position' },
        ],
        rows: topP.map((r) => ({ page: r.keys[0], clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position })) },
    ],
  };
}
