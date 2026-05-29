// src/reports/year-over-year.js
import { yearOverYearRange, pctDelta, fmtNum, fmtPct } from '../gsc-client.js';

export async function yearOverYear(gsc, { days = 28 } = {}) {
  const range = yearOverYearRange(days);
  const [currentDaily, yoyDaily, curTotal, yoyTotal, curQ, yoyQ] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['date'], rowLimit: 5000 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['date'], rowLimit: 5000 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: [], rowLimit: 1 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: [], rowLimit: 1 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['query'], rowLimit: 25 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['query'], rowLimit: 5000 }),
  ]);
  const cur = curTotal[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const yoy = yoyTotal[0] || { clicks: 0, impressions: 0, ctr: 0, position: 0 };
  const yoyMap = new Map(yoyQ.map((r) => [r.keys[0], r]));
  const queryRows = curQ.map((r) => {
    const prev = yoyMap.get(r.keys[0]) || {};
    return {
      query: r.keys[0], clicksNow: r.clicks, clicksYoy: prev.clicks || 0,
      delta: pctDelta(r.clicks, prev.clicks || 0),
      positionNow: r.position, positionYoy: prev.position || null,
    };
  });
  const labels = currentDaily.map((r) => r.keys[0]);
  const yoyClicksAligned = labels.map((_, i) => (yoyDaily[i] ? yoyDaily[i].clicks : null));
  return {
    eyebrow: 'YEAR-OVER-YEAR', title: 'YoY Performance',
    subtitle: `${days} days this year vs same window last year`,
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate} vs ${range.previous.startDate} → ${range.previous.endDate}`,
    scorecards: [
      { label: 'Clicks', value: fmtNum(cur.clicks), delta: pctDelta(cur.clicks, yoy.clicks), deltaLabel: 'YoY' },
      { label: 'Impressions', value: fmtNum(cur.impressions), delta: pctDelta(cur.impressions, yoy.impressions), deltaLabel: 'YoY' },
      { label: 'CTR', value: fmtPct(cur.ctr), delta: pctDelta(cur.ctr, yoy.ctr), deltaLabel: 'YoY' },
      { label: 'Avg Position', value: cur.position ? cur.position.toFixed(1) : '—', delta: yoy.position ? -pctDelta(cur.position, yoy.position) : null, deltaLabel: 'YoY (lower is better)' },
    ],
    sections: [
      { type: 'chart', chartType: 'line', title: 'Daily clicks — this year vs last year',
        data: { labels, series: [
          { name: 'This year', values: currentDaily.map((r) => r.clicks), color: '#f1c349' },
          { name: 'Last year', values: yoyClicksAligned, color: '#9999a3', dashed: true },
        ] } },
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 queries — clicks YoY',
        data: { labels: queryRows.slice(0, 15).map((r) => r.query),
          series: [
            { name: 'This year', values: queryRows.slice(0, 15).map((r) => r.clicksNow), color: '#f1c349' },
            { name: 'Last year', values: queryRows.slice(0, 15).map((r) => r.clicksYoy), color: '#3a3a42' },
          ] } },
      { type: 'table', title: 'Query YoY detail',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'clicksNow', label: 'Clicks now', format: 'number' },
          { key: 'clicksYoy', label: 'Clicks YoY', format: 'number' },
          { key: 'delta', label: 'Δ YoY', format: 'delta' },
          { key: 'positionNow', label: 'Pos now', format: 'position' },
          { key: 'positionYoy', label: 'Pos YoY', format: 'position' },
        ], rows: queryRows },
    ],
  };
}
