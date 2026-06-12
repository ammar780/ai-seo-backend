// src/reports/ranking-heatmap.js
//
// Position trajectory over the last N months. Uses ACTUAL calendar months
// (not 30-day approximations) so labels match windows exactly. This fixes
// the silent drift where "Mar 2026" might cover Feb 27 → Mar 28.

import { daysAgo } from '../gsc-client.js';
import { THRESHOLDS } from '../seo-constants.js';

// Build window boundaries for the last N calendar months, ending at `endDate`.
// Returns oldest-first array of { label, start, end } where dates are ISO YYYY-MM-DD.
function calendarMonths(endDateStr, months) {
  const endDate = new Date(endDateStr + 'T00:00:00Z');
  const windows = [];
  // Walk backwards from current month.
  // Current "month bucket" ends at endDate. Previous month buckets are full calendar months.
  let cursor = new Date(Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), 1));
  // Most recent (partial) window: from start of current month to endDate
  windows.push({
    year: endDate.getUTCFullYear(),
    month: endDate.getUTCMonth(),
    start: cursor.toISOString().slice(0, 10),
    end: endDateStr,
  });
  // Older full calendar months
  for (let i = 1; i < months; i++) {
    const monthStart = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() - 1, 1));
    const monthEnd = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth(), 0)); // last day of prev month
    windows.push({
      year: monthStart.getUTCFullYear(),
      month: monthStart.getUTCMonth(),
      start: monthStart.toISOString().slice(0, 10),
      end: monthEnd.toISOString().slice(0, 10),
    });
    cursor = monthStart;
  }
  // Return oldest-first
  windows.reverse();
  return windows.map((w) => ({
    label: new Date(Date.UTC(w.year, w.month, 1))
             .toLocaleString('en-US', { month: 'short', year: '2-digit', timeZone: 'UTC' }),
    start: w.start,
    end: w.end,
  }));
}

export async function rankingHeatmap(gsc, { months = 6, topQueries = 20 } = {}) {
  const endDate = daysAgo(THRESHOLDS.GSC_LAG_DAYS);
  const monthWindows = calendarMonths(endDate, months);
  const fullStart = monthWindows[0].start;

  const topRows = await gsc.query({
    startDate: fullStart, endDate,
    dimensions: ['query'], rowLimit: topQueries,
  });
  const queries = topRows.map((r) => r.keys[0]);

  const matrix = queries.map(() => new Array(monthWindows.length).fill(null));
  const dataConfidence = queries.map(() => new Array(monthWindows.length).fill(null));

  // Fetch each month in parallel
  const monthData = await Promise.all(
    monthWindows.map((win) => gsc.query({
      startDate: win.start, endDate: win.end,
      dimensions: ['query'], rowLimit: 5000,
    }))
  );

  monthData.forEach((rows, m) => {
    const map = new Map(rows.map((r) => [r.keys[0], r]));
    queries.forEach((q, qi) => {
      const row = map.get(q);
      if (!row || !row.position) return;
      // Statistical confidence: only show position if there's enough impressions
      if (row.impressions < THRESHOLDS.HEATMAP_MIN_IMPRESSIONS_PER_CELL) {
        // Mark as low-confidence — frontend can dim it
        matrix[qi][m] = +row.position.toFixed(1);
        dataConfidence[qi][m] = 'low';
      } else {
        matrix[qi][m] = +row.position.toFixed(1);
        dataConfidence[qi][m] = 'ok';
      }
    });
  });

  return {
    eyebrow: 'RANKING TRAJECTORY', title: 'Keyword Position Heatmap',
    subtitle: `Average position for top ${topQueries} queries across the last ${months} months`,
    site: gsc.siteUrl,
    dateRange: `${fullStart} → ${endDate}`,
    sections: [
      { type: 'note',
        text: `Brighter cells = better positions (lower numbers). Cells with fewer than ${THRESHOLDS.HEATMAP_MIN_IMPRESSIONS_PER_CELL} impressions are statistically unreliable and may be hidden. Look for rows that go from dim to bright (improving) or bright to dim (sliding).` },
      { type: 'heatmap', title: 'Position heatmap',
        rows: queries, cols: monthWindows.map((w) => w.label),
        values: matrix, valueFormat: 'position',
        confidence: dataConfidence },
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
