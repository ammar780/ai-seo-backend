// src/gsc-client.js
// Search Console API wrapper + mock data generator for MOCK_GSC=true mode.

import { google } from 'googleapis';

const GSC_LAG_DAYS = 2;     // GSC finalizes data ~2 days back (was 3)
const MAX_ROWS = 25000;     // GSC's hard limit per query
const RETRY_ATTEMPTS = 3;
const RETRY_BASE_MS = 500;

// Sleep helper for retry backoff
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class GSCClient {
  constructor(authClient, siteUrl) {
    this.siteUrl = siteUrl;
    this.mock = process.env.MOCK_GSC === 'true';
    if (!this.mock) this.api = google.searchconsole({ version: 'v1', auth: authClient });
    this.truncated = false;        // set true when results hit MAX_ROWS
    this.totalQueriesMade = 0;     // GSC quota tracking
  }

  async query(params) {
    if (this.mock) return generateMockRows(params);
    const { startDate, endDate, dimensions = [], filters = [],
      rowLimit = 1000, maxRows = MAX_ROWS, searchType = 'web', dataState = 'final' } = params;

    const allRows = [];
    let startRow = 0;
    while (allRows.length < maxRows) {
      const body = { startDate, endDate, dimensions,
        rowLimit: Math.min(rowLimit, maxRows - allRows.length), startRow, searchType, dataState };
      if (filters.length > 0) body.dimensionFilterGroups = [{ filters }];

      // Retry transient errors (429, 503, network) up to RETRY_ATTEMPTS
      let res;
      let lastErr;
      for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
        try {
          res = await this.api.searchanalytics.query({ siteUrl: this.siteUrl, requestBody: body });
          this.totalQueriesMade++;
          break;
        } catch (err) {
          lastErr = err;
          const status = err?.response?.status || err?.code;
          const transient = status === 429 || status === 503 || status === 502 || status === 504
                          || String(err.message).match(/ENOTFOUND|ECONNRESET|timeout/i);
          if (!transient || attempt === RETRY_ATTEMPTS) throw err;
          // Exponential backoff with jitter
          const delay = RETRY_BASE_MS * Math.pow(2, attempt - 1) + Math.random() * 200;
          await sleep(delay);
        }
      }
      if (!res) throw lastErr;

      const rows = res.data.rows || [];
      allRows.push(...rows);
      if (rows.length < body.rowLimit) break;
      startRow += rows.length;
    }
    // Mark truncation if we hit the cap
    if (allRows.length >= maxRows) this.truncated = true;
    return allRows;
  }

  async listSites() {
    if (this.mock) return [{ siteUrl: 'sc-domain:thevitaminshots.com', permissionLevel: 'siteOwner' }];
    const res = await this.api.sites.list();
    return res.data.siteEntry || [];
  }
}

export function daysAgo(n, from = new Date()) {
  const d = new Date(from);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

export function comparisonRange(days = 28, lagDays = GSC_LAG_DAYS) {
  return {
    current: { startDate: daysAgo(lagDays + days - 1), endDate: daysAgo(lagDays) },
    previous: { startDate: daysAgo(lagDays + days * 2 - 1), endDate: daysAgo(lagDays + days) },
    days,
  };
}

// Year-over-year using calendar-correct date math (handles leap years).
// Subtracts 1 year from the current period's dates, not 365 days.
export function yearOverYearRange(days = 28, lagDays = GSC_LAG_DAYS) {
  const curEnd = new Date();
  curEnd.setUTCDate(curEnd.getUTCDate() - lagDays);
  const curStart = new Date(curEnd);
  curStart.setUTCDate(curStart.getUTCDate() - (days - 1));

  // Subtract 1 calendar year for previous period
  const prevEnd = new Date(curEnd);
  prevEnd.setUTCFullYear(prevEnd.getUTCFullYear() - 1);
  const prevStart = new Date(curStart);
  prevStart.setUTCFullYear(prevStart.getUTCFullYear() - 1);

  const fmt = (d) => d.toISOString().slice(0, 10);
  return {
    current: { startDate: fmt(curStart), endDate: fmt(curEnd) },
    previous: { startDate: fmt(prevStart), endDate: fmt(prevEnd) },
    days,
  };
}

// Consistent pctDelta — returns finite numbers safe for JSON.
// 0→N is represented as 999 (matches winners-losers cap). 0→0 returns 0.
export function pctDelta(current, previous) {
  if (!previous && !current) return 0;
  if (!previous) return 999;
  const raw = ((current - previous) / previous) * 100;
  if (!Number.isFinite(raw)) return 0;
  return Math.max(-999, Math.min(999, raw));
}

// Backward-compatible alias.
export const pctDeltaCapped = pctDelta;

export function fmtNum(n) {
  if (n == null) return '—';
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(1) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return Math.round(n).toLocaleString();
}

export function fmtPct(n, digits = 2) {
  if (n == null || Number.isNaN(n)) return '—';
  return (n * 100).toFixed(digits) + '%';
}

// ─── Mock data ──────────────────────────────────────────────────────────────

const MOCK_QUERIES = [
  'vitamin shots', 'liquid multivitamin', 'vegan vitamin shots', 'glam dust',
  'best liquid vitamin', 'vitamin sprinkles', 'collagen supplement', 'b12 shot',
  'biotin liquid', 'vegan b12', 'vitamin d3 liquid', 'multivitamin subscription',
  'thevitaminshots', 'liquid b complex', 'beauty supplements', 'hair growth vitamins',
  'wellness shots', 'energy vitamins', 'immunity booster', 'skin vitamins',
  'monthly vitamin subscription', 'organic liquid vitamins', 'best collagen drink',
  'collagen sprinkles', 'beauty dust supplement', 'morning vitamin shots',
  'plant based multivitamin', 'no pill multivitamin', 'easy to absorb vitamins',
  'liquid vitamins for adults', 'best multivitamin 2026',
];

const MOCK_PAGES = [
  'https://thevitaminshots.com/',
  'https://thevitaminshots.com/products/vitamin-shots',
  'https://thevitaminshots.com/products/glam-dust',
  'https://thevitaminshots.com/products/vitamin-sprinkles',
  'https://thevitaminshots.com/blog/why-liquid-vitamins-absorb-better',
  'https://thevitaminshots.com/blog/vegan-b12-deficiency',
  'https://thevitaminshots.com/blog/collagen-vs-biotin',
  'https://thevitaminshots.com/subscribe',
  'https://thevitaminshots.com/quiz',
  'https://thevitaminshots.com/blog/morning-routine',
  'https://thevitaminshots.com/blog/best-time-take-vitamins',
  'https://thevitaminshots.com/ingredients',
  'https://thevitaminshots.com/reviews',
  'https://thevitaminshots.com/blog/biotin-hair-growth',
  'https://thevitaminshots.com/blog/d3-deficiency-signs',
  'https://thevitaminshots.com/products/bundle',
  'https://thevitaminshots.com/founders-story',
  'https://thevitaminshots.com/blog/multivitamin-guide',
  'https://thevitaminshots.com/blog/vegan-collagen-alternatives',
];

const MOCK_COUNTRIES = ['usa', 'gbr', 'can', 'aus', 'deu', 'fra', 'ind', 'nld', 'mex', 'esp'];
const MOCK_DEVICES = ['MOBILE', 'DESKTOP', 'TABLET'];

function seededRandom(seed) {
  let s = seed % 2147483647;
  if (s <= 0) s += 2147483646;
  return () => (s = (s * 16807) % 2147483647) / 2147483647;
}

function dateRangeDays(startDate, endDate) {
  const dates = [];
  const d = new Date(startDate);
  const end = new Date(endDate);
  while (d <= end) {
    dates.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return dates;
}

function applyFilters(rows, filters, keyIdx) {
  if (!filters || filters.length === 0) return rows;
  return rows.filter((r) => filters.every((f) => {
    const v = String(r.keys[keyIdx[f.dimension]] || '').toLowerCase();
    const expr = String(f.expression).toLowerCase();
    switch (f.operator) {
      case 'contains': return v.includes(expr);
      case 'notContains': return !v.includes(expr);
      case 'equals': return v === expr;
      case 'notEquals': return v !== expr;
      default: return true;
    }
  }));
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = (h * 33) ^ s.charCodeAt(i);
  return Math.abs(h);
}

function generateMockRows({ startDate, endDate, dimensions = [], filters = [], rowLimit = 1000 }) {
  const dates = dateRangeDays(startDate, endDate);
  const isYoY = new Date(startDate).getUTCFullYear() < new Date().getUTCFullYear() - 0.5;
  const seedBase = isYoY ? 17 : 42;

  if (dimensions.length === 0) {
    let clicks = 0, impressions = 0;
    for (const d of dates) {
      const r = seededRandom(seedBase + hashStr(d))();
      const dayBase = isYoY ? 280 : 380;
      const dayClicks = Math.round(dayBase + r * 280 - 60);
      const dayImpr = Math.round(dayClicks * (22 + r * 18));
      clicks += dayClicks; impressions += dayImpr;
    }
    return [{ clicks, impressions, ctr: clicks / (impressions || 1), position: 12.8 + (isYoY ? 1.8 : 0) }];
  }

  if (dimensions.length === 1 && dimensions[0] === 'date') {
    return dates.map((d) => {
      const r = seededRandom(seedBase + hashStr(d))();
      const dayBase = isYoY ? 280 : 380;
      const clicks = Math.round(dayBase + r * 280 - 60);
      const impressions = Math.round(clicks * (22 + r * 18));
      return { keys: [d], clicks, impressions, ctr: clicks / impressions, position: 11 + r * 6 };
    });
  }

  if (dimensions.length === 2 && dimensions[0] === 'date' && dimensions[1] === 'device') {
    const out = [];
    for (const d of dates) {
      const r = seededRandom(seedBase + hashStr(d));
      const total = Math.round(380 + r() * 280);
      out.push({ keys: [d, 'MOBILE'], clicks: Math.round(total * 0.62), impressions: Math.round(total * 22), ctr: 0.028, position: 14.1 });
      out.push({ keys: [d, 'DESKTOP'], clicks: Math.round(total * 0.33), impressions: Math.round(total * 11), ctr: 0.030, position: 11.4 });
      out.push({ keys: [d, 'TABLET'], clicks: Math.round(total * 0.05), impressions: Math.round(total * 2), ctr: 0.025, position: 13.8 });
    }
    return out;
  }

  if (dimensions.length === 1) {
    const dim = dimensions[0];
    let items = [];
    if (dim === 'query') items = MOCK_QUERIES;
    else if (dim === 'page') items = MOCK_PAGES;
    else if (dim === 'country') items = MOCK_COUNTRIES;
    else if (dim === 'device') items = MOCK_DEVICES;

    const dayIdx = Math.floor((new Date(endDate) - new Date('2024-01-01')) / 86400000);
    const driftPhase = (dayIdx % 365) / 365;

    let rows = items.map((item, i) => {
      const itemHash = hashStr(item);
      const r = seededRandom(seedBase + itemHash)();
      const driftR = seededRandom(itemHash + dayIdx)();
      const rank = i + 1;
      const baseClicks = Math.round((1800 / rank) * (0.7 + r * 0.6) * (isYoY ? 0.78 : 1) * (0.85 + driftR * 0.3));
      const direction = itemHash % 2 === 0 ? -1 : 1;
      const drift = direction * Math.sin(driftPhase * Math.PI * 2 + r) * 1.5;
      let position;
      if (dim === 'query') position = 1.2 + i * 0.5 + r * 1.5 + drift;
      else if (dim === 'page') position = 8 + r * 6 + drift;
      else position = 5 + r * 12;
      position = Math.max(1, position);
      const ctr = Math.max(0.005, 0.18 / Math.sqrt(position) * (0.6 + r * 0.5));
      const impressions = Math.round(baseClicks / ctr);
      return { keys: [item], clicks: baseClicks, impressions, ctr, position };
    });

    const keyIdx = {}; keyIdx[dim] = 0;
    rows = applyFilters(rows, filters, keyIdx);
    return rows.slice(0, rowLimit);
  }

  return [];
}
