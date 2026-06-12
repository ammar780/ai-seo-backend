// src/reports/ctr-opportunities.js
//
// Finds queries with high impression volume but below-benchmark CTR for their
// position — candidates for title and meta description rewrites.
//
// All CTR benchmarks and thresholds live in src/seo-constants.js — see that
// file for the methodology. Conservative upside (50% of CTR gap) matches
// real A/B test outcomes for title/meta changes.

import { comparisonRange } from '../gsc-client.js';
import { EXPECTED_CTR, expectedCtrFor, THRESHOLDS } from '../seo-constants.js';

export async function ctrOpportunities(gsc, {
  days = 28,
  minImpressions = THRESHOLDS.CTR_MIN_IMPRESSIONS,
  maxPosition = THRESHOLDS.CTR_MAX_POSITION,
} = {}) {
  const range = comparisonRange(days);
  const rows = await gsc.query({
    startDate: range.current.startDate, endDate: range.current.endDate,
    dimensions: ['query'], rowLimit: 5000,
  });

  // Adaptive threshold: if no opportunities found, progressively lower
  let effectiveMin = minImpressions;
  let opportunities = findOpportunities(rows, effectiveMin, maxPosition);
  if (opportunities.length === 0 && minImpressions > 25) {
    for (const tryMin of [100, 50, 25, 10]) {
      effectiveMin = tryMin;
      opportunities = findOpportunities(rows, tryMin, maxPosition);
      if (opportunities.length > 0) break;
    }
  }

  const totalUpside = opportunities.reduce((s, r) => s + r.potentialClicks, 0);
  // Count page-1 queries with any impressions — context for empty state
  const totalP1Queries = rows.filter((r) => r.position >= 0 && r.position <= maxPosition && r.impressions > 0).length;
  const adaptedNote = effectiveMin < minImpressions
    ? ` (auto-lowered min impressions from ${minImpressions} to ${effectiveMin})` : '';

  return {
    eyebrow: 'CTR OPPORTUNITIES', title: 'Title & Meta Win Candidates',
    subtitle: 'Page-1 queries with high impressions but below-benchmark CTR — candidates for title and meta description rewrites',
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    scorecards: [
      { label: 'Opportunities found', value: opportunities.length.toLocaleString() },
      { label: 'Realistic upside / period', value: totalUpside.toLocaleString() + ' clicks' },
      { label: 'Min impressions', value: effectiveMin.toLocaleString() },
      { label: 'Max position', value: maxPosition.toString() },
    ],
    sections: [
      { type: 'note',
        text: `Benchmarks reflect 2026 post-AI-Overview CTR floors. Upside is conservative: ${THRESHOLDS.CTR_LIFT_REALISM * 100}% of the CTR gap × impressions, matching real A/B test outcomes. Queries already within ${THRESHOLDS.CTR_UNDERPERFORMANCE * 100}% of benchmark are excluded.${adaptedNote} Click "AI: Rewrite Titles" below for optimized variants.` },
      ...(opportunities.length > 0 ? [{
        type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 opportunities — realistic click upside',
        data: { labels: opportunities.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Potential clicks', values: opportunities.slice(0, 15).map((r) => r.potentialClicks), color: '#f1c349' }] }
      }] : [{
        type: 'note',
        text: totalP1Queries < 10
          ? `⚠ Your site doesn't have enough page-1 rankings yet for CTR optimization — only ${totalP1Queries} queries reach page 1 with any impressions. CTR Opportunities works once you have a base of page-1 rankings to optimize. PRIORITY: focus on Content Gap Finder + AI Cluster to build pages that earn rankings first. Once those rankings reach page 1, return here.`
          : `⚠ No CTR opportunities found — your page-1 queries are already hitting CTR benchmarks (this is good!) OR your titles are already well-optimized. Try a longer date range to confirm.`,
      }]),
      { type: 'table', title: 'All opportunities',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'position', label: 'Position', format: 'position' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'Actual CTR', format: 'pct' },
          { key: 'expectedCtr', label: 'Benchmark CTR', format: 'pct' },
          { key: 'clicks', label: 'Clicks now', format: 'number' },
          { key: 'potentialClicks', label: 'Realistic upside', format: 'number' },
        ], rows: opportunities },
    ],
    aiActions: ['titleRewrites'],
    rawData: opportunities.slice(0, 20),
  };
}

function findOpportunities(rows, minImpressions, maxPosition) {
  return rows
    .filter((r) => r.impressions >= minImpressions && r.position <= maxPosition && r.position >= 0)
    .map((r) => {
      const expected = expectedCtrFor(r.position);
      const underperformanceRatio = expected > 0 ? r.ctr / expected : 1;
      if (underperformanceRatio >= THRESHOLDS.CTR_UNDERPERFORMANCE) return null;
      const gap = expected - r.ctr;
      const realisticUpsidePct = gap * THRESHOLDS.CTR_LIFT_REALISM;
      const potentialClicks = Math.max(0, Math.round(realisticUpsidePct * r.impressions));
      return {
        query: r.keys[0],
        impressions: r.impressions, clicks: r.clicks, ctr: r.ctr,
        expectedCtr: expected, ctrGap: gap, position: r.position,
        potentialClicks, underperformanceRatio,
      };
    })
    .filter((r) => r && r.potentialClicks >= THRESHOLDS.CTR_MIN_UPSIDE_CLICKS)
    .sort((a, b) => b.potentialClicks - a.potentialClicks)
    .slice(0, 50);
}
