// src/reports/winners-losers.js
//
// Pages and queries with the biggest absolute click movement vs prior period.
//
// Filtering scales with site size:
// - Small site (<100 clicks/period total): use base thresholds (5/10)
// - Medium site (100-10k): scale up by site size factor
// - Large site (>10k): use percentile-based filter

import { comparisonRange } from '../gsc-client.js';
import { THRESHOLDS } from '../seo-constants.js';

export async function winnersLosers(gsc, { days = 28, limit = 25 } = {}) {
  const range = comparisonRange(days);
  const [curPages, prevPages, curQ, prevQ] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['page'], rowLimit: 5000 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['page'], rowLimit: 5000 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['query'], rowLimit: 5000 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['query'], rowLimit: 5000 }),
  ]);

  // Total site traffic in current period — used to scale noise thresholds
  const totalClicks = curPages.reduce((s, r) => s + r.clicks, 0);
  const { minBaseline, minNewItem } = computeAdaptiveThresholds(totalClicks);

  const pageMov = computeMovement(curPages, prevPages, minBaseline, minNewItem);
  const queryMov = computeMovement(curQ, prevQ, minBaseline, minNewItem);

  const pageLosers  = pageMov.filter((r) => r.clickDelta < 0).sort((a, b) => a.clickDelta - b.clickDelta).slice(0, limit).map(formatPageRow);
  const pageWinners = pageMov.filter((r) => r.clickDelta > 0).sort((a, b) => b.clickDelta - a.clickDelta).slice(0, limit).map(formatPageRow);
  const queryLosers  = queryMov.filter((r) => r.clickDelta < 0).sort((a, b) => a.clickDelta - b.clickDelta).slice(0, limit).map(formatQueryRow);
  const queryWinners = queryMov.filter((r) => r.clickDelta > 0).sort((a, b) => b.clickDelta - a.clickDelta).slice(0, limit).map(formatQueryRow);

  return {
    eyebrow: 'WHAT CHANGED', title: 'Winners & Losers',
    subtitle: `Biggest absolute click movement over the last ${days} days · noise-filtered (min ${minBaseline} clicks)`,
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate} vs ${range.previous.startDate} → ${range.previous.endDate}`,
    sections: [
      { type: 'note',
        text: `Filtered to items with ≥${minBaseline} clicks in at least one period, or ≥${minNewItem} clicks if previously zero. Thresholds scale with your site's total volume (${totalClicks.toLocaleString()} clicks this period). Use AI Diagnose below for hypothesis-driven analysis of the losers — covers algorithm updates, AI Overview cannibalization, ranking drops, seasonality, and technical issues.` },
      { type: 'table', title: `Page winners (top ${pageWinners.length})`, subtitle: 'Pages gaining the most clicks',
        columns: pageColumns(), rows: pageWinners },
      { type: 'table', title: `Page losers (top ${pageLosers.length})`, subtitle: 'Pages losing the most clicks — likely candidates for investigation',
        columns: pageColumns(), rows: pageLosers },
      { type: 'table', title: `Query winners (top ${queryWinners.length})`, subtitle: 'Queries driving the most new clicks',
        columns: queryColumns(), rows: queryWinners },
      { type: 'table', title: `Query losers (top ${queryLosers.length})`, subtitle: 'Queries that lost the most clicks',
        columns: queryColumns(), rows: queryLosers },
    ],
    aiActions: ['diagnose'],
    rawData: {
      pageLosers: pageLosers.slice(0, 10),
      queryLosers: queryLosers.slice(0, 10),
      pageWinners: pageWinners.slice(0, 5),
      queryWinners: queryWinners.slice(0, 5),
      totalClicks,
      thresholds: { minBaseline, minNewItem },
    },
  };
}

// Adaptive thresholds scale with site volume so small sites surface items
// and large sites aren't buried in noise.
function computeAdaptiveThresholds(totalClicks) {
  const base = THRESHOLDS.WL_MIN_BASELINE_CLICKS_BASE;
  const baseNew = THRESHOLDS.WL_MIN_NEW_ITEM_CLICKS_BASE;
  if (totalClicks < 100)     return { minBaseline: base,           minNewItem: baseNew };
  if (totalClicks < 1000)    return { minBaseline: base * 2,       minNewItem: baseNew * 2 };
  if (totalClicks < 10000)   return { minBaseline: base * 4,       minNewItem: baseNew * 4 };
  if (totalClicks < 100000)  return { minBaseline: base * 10,      minNewItem: baseNew * 10 };
  return                          { minBaseline: base * 20,      minNewItem: baseNew * 20 };
}

function computeMovement(current, previous, minBaseline, minNewItem) {
  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));
  const curMap = new Map(current.map((r) => [r.keys[0], r]));
  const allKeys = new Set([...prevMap.keys(), ...curMap.keys()]);
  const result = [];
  for (const k of allKeys) {
    const cur = curMap.get(k) || { clicks: 0, impressions: 0, position: null };
    const prev = prevMap.get(k) || { clicks: 0, impressions: 0, position: null };
    const clickDelta = cur.clicks - prev.clicks;
    const maxClicks = Math.max(cur.clicks, prev.clicks);
    if (maxClicks < minBaseline) continue;
    if (prev.clicks === 0 && cur.clicks < minNewItem) continue;
    if (cur.clicks === 0 && prev.clicks < minNewItem) continue;
    if (clickDelta === 0) continue;

    let pctDelta = prev.clicks ? ((cur.clicks - prev.clicks) / prev.clicks) * 100 : (cur.clicks ? 999 : 0);
    pctDelta = Math.max(-999, Math.min(999, pctDelta));

    result.push({
      key: k,
      clickDelta,
      clicksNow: cur.clicks, clicksPrev: prev.clicks,
      pctDelta,
      impressionsNow: cur.impressions, impressionsPrev: prev.impressions,
      positionNow: cur.position, positionPrev: prev.position,
    });
  }
  return result;
}

function pageColumns() {
  return [
    { key: 'page', label: 'Page', format: 'url' },
    { key: 'clicksNow', label: 'Clicks now', format: 'number' },
    { key: 'clicksPrev', label: 'Prev', format: 'number' },
    { key: 'clickDelta', label: 'Δ', format: 'number' },
    { key: 'pctDelta', label: 'Δ %', format: 'delta' },
    { key: 'positionNow', label: 'Pos', format: 'position' },
  ];
}
function queryColumns() {
  return [
    { key: 'query', label: 'Query' },
    { key: 'clicksNow', label: 'Clicks now', format: 'number' },
    { key: 'clicksPrev', label: 'Prev', format: 'number' },
    { key: 'clickDelta', label: 'Δ', format: 'number' },
    { key: 'pctDelta', label: 'Δ %', format: 'delta' },
    { key: 'positionNow', label: 'Pos', format: 'position' },
  ];
}
function formatPageRow(r) { let page = r.key; try { page = new URL(r.key).pathname; } catch {} return { ...r, page }; }
function formatQueryRow(r) { return { ...r, query: r.key }; }
