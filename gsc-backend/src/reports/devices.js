// src/reports/devices.js
import { comparisonRange, pctDelta } from '../gsc-client.js';

const COLORS = { MOBILE: '#f1c349', DESKTOP: '#60a5fa', TABLET: '#a78bfa' };

export async function devices(gsc, { days = 28 } = {}) {
  const range = comparisonRange(days);
  const [current, previous, dailyByDevice] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['device'], rowLimit: 10 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['device'], rowLimit: 10 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['date', 'device'], rowLimit: 5000 }),
  ]);
  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));
  const totalClicks = current.reduce((s, r) => s + r.clicks, 0) || 1;
  const rows = current.map((r) => {
    const prev = prevMap.get(r.keys[0]) || {};
    return {
      device: r.keys[0], clicks: r.clicks, share: r.clicks / totalClicks,
      clicksDelta: pctDelta(r.clicks, prev.clicks || 0),
      impressions: r.impressions, ctr: r.ctr, position: r.position,
    };
  });
  const dates = [...new Set(dailyByDevice.map((r) => r.keys[0]))].sort();
  const series = ['MOBILE', 'DESKTOP', 'TABLET'].map((dev) => ({
    name: dev.charAt(0) + dev.slice(1).toLowerCase(),
    color: COLORS[dev],
    values: dates.map((d) => {
      const row = dailyByDevice.find((r) => r.keys[0] === d && r.keys[1] === dev);
      return row ? row.clicks : 0;
    }),
  }));
  return {
    eyebrow: 'DEVICE BREAKDOWN', title: 'Performance by Device',
    subtitle: `${days}-day period · mobile vs desktop vs tablet`,
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    sections: [
      { type: 'chart', chartType: 'doughnut', title: 'Click share by device',
        data: { labels: rows.map((r) => r.device), colors: rows.map((r) => COLORS[r.device] || '#9999a3'), values: rows.map((r) => r.clicks) } },
      { type: 'chart', chartType: 'line', title: 'Daily clicks by device', data: { labels: dates, series } },
      { type: 'table', title: 'Device metrics',
        columns: [
          { key: 'device', label: 'Device' },
          { key: 'clicks', label: 'Clicks', format: 'number' },
          { key: 'share', label: 'Share', format: 'pct' },
          { key: 'clicksDelta', label: 'Δ vs prior', format: 'delta' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'CTR', format: 'pct' },
          { key: 'position', label: 'Avg Position', format: 'position' },
        ], rows },
    ],
  };
}
