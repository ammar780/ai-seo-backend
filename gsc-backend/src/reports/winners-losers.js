// src/reports/winners-losers.js
import { comparisonRange } from '../gsc-client.js';

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
  const pageLosers = [...pageMov].sort((a, b) => a.clickDelta - b.clickDelta).slice(0, limit).map(formatPageRow);
  return {
    eyebrow: 'WHAT CHANGED', title: 'Winners & Losers',
    subtitle: `Biggest absolute click movement over the last ${days} days`,
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate} vs ${range.previous.startDate} → ${range.previous.endDate}`,
    sections: [
      { type: 'table', title: `Page winners (+${limit})`, subtitle: 'Pages that gained the most clicks',
        columns: pageColumns(),
        rows: [...pageMov].sort((a, b) => b.clickDelta - a.clickDelta).slice(0, limit).map(formatPageRow) },
      { type: 'table', title: `Page losers (-${limit})`, subtitle: 'Pages that lost the most clicks — investigate ranking drops or canonical changes',
        columns: pageColumns(), rows: pageLosers },
      { type: 'table', title: `Query winners (+${limit})`, subtitle: 'Queries driving the most new clicks',
        columns: queryColumns(),
        rows: [...queryMov].sort((a, b) => b.clickDelta - a.clickDelta).slice(0, limit).map(formatQueryRow) },
      { type: 'table', title: `Query losers (-${limit})`, subtitle: 'Queries that lost the most clicks',
        columns: queryColumns(),
        rows: [...queryMov].sort((a, b) => a.clickDelta - b.clickDelta).slice(0, limit).map(formatQueryRow) },
    ],
    aiActions: ['diagnose'],
    rawData: { pageLosers: pageLosers.slice(0, 10), queryLosers: [...queryMov].sort((a,b)=>a.clickDelta-b.clickDelta).slice(0,10).map(formatQueryRow) },
  };
}

function computeMovement(current, previous) {
  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));
  const curMap = new Map(current.map((r) => [r.keys[0], r]));
  const allKeys = new Set([...prevMap.keys(), ...curMap.keys()]);
  return [...allKeys].map((k) => {
    const cur = curMap.get(k) || { clicks: 0, position: null };
    const prev = prevMap.get(k) || { clicks: 0, position: null };
    return {
      key: k,
      clickDelta: cur.clicks - prev.clicks,
      clicksNow: cur.clicks, clicksPrev: prev.clicks,
      pctDelta: prev.clicks ? ((cur.clicks - prev.clicks) / prev.clicks) * 100 : (cur.clicks ? 100 : 0),
      positionNow: cur.position, positionPrev: prev.position,
    };
  });
}

function pageColumns() {
  return [
    { key: 'page', label: 'Page', format: 'url' },
    { key: 'clicksNow', label: 'Clicks now', format: 'number' },
    { key: 'clicksPrev', label: 'Clicks prev', format: 'number' },
    { key: 'clickDelta', label: 'Δ Clicks', format: 'number' },
    { key: 'pctDelta', label: 'Δ %', format: 'delta' },
    { key: 'positionNow', label: 'Pos now', format: 'position' },
  ];
}
function queryColumns() {
  return [
    { key: 'query', label: 'Query' },
    { key: 'clicksNow', label: 'Clicks now', format: 'number' },
    { key: 'clicksPrev', label: 'Clicks prev', format: 'number' },
    { key: 'clickDelta', label: 'Δ Clicks', format: 'number' },
    { key: 'pctDelta', label: 'Δ %', format: 'delta' },
    { key: 'positionNow', label: 'Pos now', format: 'position' },
  ];
}
function formatPageRow(r) { let page = r.key; try { page = new URL(r.key).pathname; } catch {} return { ...r, page }; }
function formatQueryRow(r) { return { ...r, query: r.key }; }
