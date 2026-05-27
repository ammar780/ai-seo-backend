// src/reports/ranking-heatmap.js
import { daysAgo } from '../gsc-client.js';

export async function rankingHeatmap(gsc, { months = 6, topQueries = 20 } = {}) {
  const endDate = daysAgo(3);
  const fullStart = daysAgo(3 + months * 30);
  const topRows = await gsc.query({ startDate: fullStart, endDate, dimensions: ['query'], rowLimit: topQueries });
  const queries = topRows.map((r) => r.keys[0]);
  const monthWindows = [];
  for (let i = 0; i < months; i++) {
    monthWindows.unshift({
      label: monthLabel(i),
      start: daysAgo(3 + (i + 1) * 30),
      end: daysAgo(3 + i * 30 + 1),
    });
  }
  const matrix = queries.map(() => new Array(monthWindows.length).fill(null));
  const monthData = await Promise.all(
    monthWindows.map((win) => gsc.query({ startDate: win.start, endDate: win.end, dimensions: ['query'], rowLimit: 5000 }))
  );
  monthData.forEach((rows, m) => {
    const map = new Map(rows.map((r) => [r.keys[0], r]));
    queries.forEach((q, qi) => {
      const row = map.get(q);
      matrix[qi][m] = row && row.position ? +row.position.toFixed(1) : null;
    });
  });
  return {
    eyebrow: 'RANKING TRAJECTORY', title: 'Keyword Position Heatmap',
    subtitle: `Average position for top ${topQueries} queries across the last ${months} months`,
    site: gsc.siteUrl,
    dateRange: `${monthWindows[0].start} → ${endDate}`,
    sections: [
      { type: 'note', text: 'Brighter cells = better positions (lower numbers). Look for rows that go from dim to bright (improving) or bright to dim (sliding).' },
      { type: 'heatmap', title: 'Position heatmap',
        rows: queries, cols: monthWindows.map((w) => w.label),
        values: matrix, valueFormat: 'position' },
      { type: 'table', title: 'Position change — oldest vs newest month',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'first', label: monthWindows[0].label, format: 'position' },
          { key: 'last', label: monthWindows[monthWindows.length - 1].label, format: 'position' },
          { key: 'change', label: 'Δ Position' },
        ],
        rows: queries.map((q, i) => {
          const first = matrix[i][0], last = matrix[i][monthWindows.length - 1];
          const change = first != null && last != null ? +(first - last).toFixed(1) : null;
          let changeStr = '—';
          if (change != null) {
            const sign = change > 0 ? '↑ +' : change < 0 ? '↓ ' : '';
            changeStr = sign + change.toFixed(1);
          }
          return { query: q, first, last, change: changeStr };
        }) },
    ],
  };
}

function monthLabel(monthsAgo) {
  const d = new Date();
  d.setMonth(d.getMonth() - monthsAgo);
  return d.toLocaleString('en-US', { month: 'short', year: '2-digit' });
}
