// src/reports/winners-losers.js
//
// Identifies pages and queries with the biggest absolute click movement
// vs the prior period.
//
// Filtering rules to reduce noise:
// - Drop items with <5 clicks in BOTH periods (too small to matter)
// - Drop items with no historical baseline if movement < 10 clicks (likely new)
// - Cap percentage delta at ±999% to keep displays readable

import { comparisonRange } from '../gsc-client.js';

const MIN_BASELINE_CLICKS = 5;       // Either period must have at least this
const MIN_NEW_ITEM_CLICKS = 10;      // New items (0 baseline) need this much to count

export async function winnersLosers(gsc, { days = 28, limit = 25 } = {}) {
  const range = comparisonRange(days);
  const [curPages, prevPages, curQ, prevQ] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['page'], rowLimit: 5000 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['page'], rowLimit: 5000 }),
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['query'], rowLimit: 5000 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['query'], rowLimit: 5000 }),
  ]);

  const pageMov = computeMovement(curPages, prevPages);
  const queryMov = computeMovement(curQ, prevQ);

  const pageLosers  = pageMov.filter((r) => r.clickDelta < 0).sort((a, b) => a.clickDelta - b.clickDelta).slice(0, limit).map(formatPageRow);
  const pageWinners = pageMov.filter((r) => r.clickDelta > 0).sort((a, b) => b.clickDelta - a.clickDelta).slice(0, limit).map(formatPageRow);
  const queryLosers  = queryMov.filter((r) => r.clickDelta < 0).sort((a, b) => a.clickDelta - b.clickDelta).slice(0, limit).map(formatQueryRow);
  const queryWinners = queryMov.filter((r) => r.clickDelta > 0).sort((a, b) => b.clickDelta - a.clickDelta).slice(0, limit).map(formatQueryRow);

  return {
    eyebrow: 'WHAT CHANGED', title: 'Winners & Losers',
    subtitle: `Biggest absolute click movement over the last ${days} days · noise-filtered`,
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate} vs ${range.previous.startDate} → ${range.previous.endDate}`,
    sections: [
      { type: 'note',
        text: `Filtered to items with ≥${MIN_BASELINE_CLICKS} clicks in at least one period, or ≥${MIN_NEW_ITEM_CLICKS} clicks if previously zero. Use AI Diagnose below for hypothesis-driven analysis of the losers — covers algorithm updates, AI Overview cannibalization, ranking drops, seasonality, and technical issues.` },
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
      pageWinners: pageWinners.slice(0, 5),  // Context — what's working
      queryWinners: queryWinners.slice(0, 5),
    },
  };
}

function computeMovement(current, previous) {
  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));
  const curMap = new Map(current.map((r) => [r.keys[0], r]));
  const allKeys = new Set([...prevMap.keys(), ...curMap.keys()]);
  const result = [];
  for (const k of allKeys) {
    const cur = curMap.get(k) || { clicks: 0, impressions: 0, position: null };
    const prev = prevMap.get(k) || { clicks: 0, impressions: 0, position: null };
    const clickDelta = cur.clicks - prev.clicks;
    // Noise filter
    const maxClicks = Math.max(cur.clicks, prev.clicks);
    if (maxClicks < MIN_BASELINE_CLICKS) continue;
    if (prev.clicks === 0 && cur.clicks < MIN_NEW_ITEM_CLICKS) continue;
    if (cur.clicks === 0 && prev.clicks < MIN_NEW_ITEM_CLICKS) continue;
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
