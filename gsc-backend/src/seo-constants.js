// src/seo-constants.js
//
// Single source of truth for all SEO constants used across reports.
// Update values HERE — every report that imports from this module gets
// the new values automatically. Prevents silent drift between reports.
//
// SOURCES (verified mid-2026):
// - Backlinko 4M-result CTR study (2024)
// - First Page Sage CTR study (2024)
// - Ahrefs AI Overview impact study (Feb 2026)
// - Seer Interactive CTR research (2026)
// - Advanced Web Ranking quarterly studies
//
// We use the CONSERVATIVE side of published benchmarks because:
//   1) AI Overviews now appear on ~13% of US queries and cap upside
//   2) Conservative estimates avoid over-promising in AI-suggested actions
//   3) Surfaces only the clearest opportunities (high signal, low noise)

// ─── CTR BENCHMARKS BY POSITION ────────────────────────────────────────────
// Achievable CTR floors at each position 1-10. Used by ctr-opportunities and
// ai-overview-impact reports. Linearly interpolated for fractional positions.
export const EXPECTED_CTR = {
  1: 0.275,   // Position 1: 27.5%
  2: 0.155,   // Position 2: 15.5%
  3: 0.100,   // Position 3: 10.0%
  4: 0.070,   // Position 4: 7.0%
  5: 0.050,   // Position 5: 5.0%
  6: 0.035,   // Position 6: 3.5%
  7: 0.025,   // Position 7: 2.5%
  8: 0.020,   // Position 8: 2.0%
  9: 0.016,   // Position 9: 1.6%
  10: 0.013,  // Position 10: 1.3%
};

export function expectedCtrFor(pos) {
  if (pos == null || !Number.isFinite(pos)) return 0;
  // Featured snippets (position 0) capture ~43% per various studies
  if (pos < 1) return 0.43;
  if (pos >= 10) return EXPECTED_CTR[10];
  const lower = Math.floor(pos);
  const upper = Math.ceil(pos);
  if (lower === upper) return EXPECTED_CTR[lower] ?? EXPECTED_CTR[10];
  const t = pos - lower;
  return EXPECTED_CTR[lower] * (1 - t) + EXPECTED_CTR[upper] * t;
}

// ─── INFORMATIONAL INTENT MARKERS ──────────────────────────────────────────
// Expanded list (English + question patterns + implicit info markers).
// Used to identify queries vulnerable to AI Overview cannibalization.
export const INFORMATIONAL_MARKERS = [
  // Question words
  'how ', 'what ', 'why ', 'when ', 'where ', 'who ', 'which ', 'whose ',
  // Comparative
  'best ', 'top ', 'vs ', ' vs', 'difference', 'compare', 'comparison',
  'versus', 'or ', ' or ', 'better than',
  // Educational
  'guide', 'tutorial', 'tips', 'ideas', 'examples', 'explained',
  'meaning', 'definition', 'reasons', 'benefits', 'pros', 'cons',
  // Implicit information seeking
  'dosage', 'dose', 'side effects', 'symptoms', 'causes', 'cure',
  'review', 'reviews', 'rated', 'rating', 'safe', 'dangerous',
  'how much', 'how many', 'how often', 'how long',
  // List patterns
  '10 ', '5 ', '7 ', '20 ', 'list of', 'types of', 'kinds of',
];

export function isInformationalQuery(query) {
  if (!query || typeof query !== 'string') return false;
  const q = query.toLowerCase().trim();
  // Question mark at end = clearly informational
  if (q.endsWith('?')) return true;
  return INFORMATIONAL_MARKERS.some((m) => q.includes(m));
}

// ─── BRAND DETECTION ───────────────────────────────────────────────────────
// Returns true if query contains any brand term (case-insensitive).
export function isBrandQuery(query, brandTerms = '') {
  if (!brandTerms || !query) return false;
  const q = String(query).toLowerCase();
  const terms = String(brandTerms)
    .toLowerCase()
    .split(/[,;|]/)
    .map((t) => t.trim())
    .filter(Boolean);
  return terms.some((t) => q.includes(t));
}

// ─── REPORT THRESHOLDS ─────────────────────────────────────────────────────
// Centralized defaults so they don't drift across reports.

export const THRESHOLDS = {
  // CTR opportunities
  CTR_UNDERPERFORMANCE: 0.70,       // queries within 70% of benchmark are NOT flagged
  CTR_MIN_UPSIDE_CLICKS: 8,         // minimum estimated upside to surface as opportunity
  CTR_LIFT_REALISM: 0.5,            // assume rewrite captures HALF the gap (real-world A/B testing)
  CTR_MIN_IMPRESSIONS: 200,         // min impressions to consider a query for CTR opps
  CTR_MAX_POSITION: 10,             // page 1 only

  // AI Overview cannibalization
  AIO_MIN_SHORTFALL: 0.40,          // CTR must be 40%+ below benchmark
  AIO_HIGH_SHORTFALL: 0.50,         // 50%+ below = strong signal
  AIO_MIN_IMPRESSIONS: 300,         // need volume to be confident
  AIO_HIGH_THRESHOLD: 4,            // 4 of 4 signals
  AIO_MEDIUM_THRESHOLD: 3,          // 3 of 4 signals (was effectively 2 — too lenient)

  // Content gaps
  GAPS_MIN_IMPRESSIONS: 300,
  GAPS_MIN_POSITION: 11,            // page 2+
  GAPS_MAX_POSITION: 50,

  // Winners/losers — base values, scaled adaptively by site size
  WL_MIN_BASELINE_CLICKS_BASE: 5,
  WL_MIN_NEW_ITEM_CLICKS_BASE: 10,

  // Heatmap
  HEATMAP_MIN_IMPRESSIONS_PER_CELL: 50,  // statistical floor

  // Data freshness
  GSC_LAG_DAYS: 2,                  // GSC finalizes data ~2 days ago
};

// ─── PARAMETER BOUNDS ──────────────────────────────────────────────────────
// Hard maximums to prevent DoS and invalid dates. GSC's hard limit is 16 months.

export const BOUNDS = {
  days:           { min: 1, max: 480, default: 28 },     // 16 months max
  months:         { min: 1, max: 16,  default: 6 },
  limit:          { min: 1, max: 1000, default: 50 },
  topQueries:     { min: 1, max: 100, default: 20 },
  minImpressions: { min: 1, max: 1000000, default: 200 },
  minPosition:    { min: 0, max: 100, default: 1 },
  maxPosition:    { min: 1, max: 100, default: 50 },
};

// Bounded integer parser. Returns default for invalid/out-of-range values.
export function boundedInt(value, bounds) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return bounds.default;
  if (n < bounds.min) return bounds.min;
  if (n > bounds.max) return bounds.max;
  return n;
}

// ─── GOOGLE ALGORITHM UPDATE TIMELINE ──────────────────────────────────────
// Used to overlay update dates on trend charts and inform AI diagnosis.
// Update this list as Google announces new updates.
export const ALGORITHM_UPDATES = [
  { date: '2024-03-05', name: 'March 2024 Core Update', impact: 'major' },
  { date: '2024-05-14', name: 'AI Overviews launch (US)', impact: 'major' },
  { date: '2024-08-15', name: 'August 2024 Core Update', impact: 'major' },
  { date: '2024-11-11', name: 'November 2024 Core Update', impact: 'major' },
  { date: '2024-12-12', name: 'December 2024 Core Update', impact: 'medium' },
  { date: '2024-12-19', name: 'December 2024 Spam Update', impact: 'medium' },
  { date: '2025-03-13', name: 'March 2025 Core Update', impact: 'major' },
  { date: '2025-06-30', name: 'June 2025 Core Update', impact: 'major' },
  { date: '2025-08-12', name: 'August 2025 Core + HCS Integration', impact: 'major' },
  { date: '2025-11-04', name: 'November 2025 Core Update', impact: 'medium' },
  { date: '2026-03-08', name: 'March 2026 Core Update', impact: 'major' },
];

// Returns updates that fell within the given date range (inclusive).
export function updatesInRange(startDate, endDate) {
  return ALGORITHM_UPDATES.filter((u) => u.date >= startDate && u.date <= endDate);
}
