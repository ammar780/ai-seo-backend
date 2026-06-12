// src/reports/ai-overview-impact.js
//
// AI Overview Cannibalization Detector — the #1 SEO issue of 2025-2026.
// Identifies queries where the site maintains good position but CTR has
// collapsed. These are likely AI Overview footprint candidates.

import { comparisonRange } from '../gsc-client.js';
import { expectedCtrFor, isInformationalQuery, THRESHOLDS } from '../seo-constants.js';

export async function aiOverviewImpact(gsc, {
  days = 28,
  minImpressions = THRESHOLDS.AIO_MIN_IMPRESSIONS,
} = {}) {
  const range = comparisonRange(days);

  const [current, previous] = await Promise.all([
    gsc.query({ startDate: range.current.startDate, endDate: range.current.endDate, dimensions: ['query'], rowLimit: 5000 }),
    gsc.query({ startDate: range.previous.startDate, endDate: range.previous.endDate, dimensions: ['query'], rowLimit: 5000 }),
  ]);

  const prevMap = new Map(previous.map((r) => [r.keys[0], r]));

  // ADAPTIVE THRESHOLD — try progressively lower minImpressions for small sites
  let effectiveMin = minImpressions;
  let cannibalized = findCannibalized(current, prevMap, effectiveMin);
  if (cannibalized.length === 0 && minImpressions > 25) {
    for (const tryMin of [150, 75, 30, 15]) {
      effectiveMin = tryMin;
      cannibalized = findCannibalized(current, prevMap, tryMin);
      if (cannibalized.length > 0) break;
    }
  }

  const highConf = cannibalized.filter((r) => r.confidence === 'High').length;
  const totalLostClicks = cannibalized.reduce((s, r) => {
    const expectedClicks = r.expectedCtr * r.impressions;
    return s + Math.max(0, (expectedClicks - r.clicks) * 0.5);
  }, 0);

  // Total page-1 queries with any impressions — context for empty state
  const totalP1Queries = current.filter((r) => r.position >= 0 && r.position <= 10 && r.impressions > 0).length;
  const adaptedNote = effectiveMin < minImpressions
    ? ` (auto-lowered min impressions from ${minImpressions} to ${effectiveMin} — site has lower query volume)` : '';

  return {
    eyebrow: 'AI OVERVIEW IMPACT',
    title: 'AI Overview Cannibalization',
    subtitle: 'Queries where you rank well but CTR has collapsed — likely AI Overview footprint',
    site: gsc.siteUrl,
    dateRange: `${range.current.startDate} → ${range.current.endDate}`,
    scorecards: [
      { label: 'Affected queries', value: cannibalized.length.toLocaleString() },
      { label: 'High-confidence AIO', value: highConf.toLocaleString() },
      { label: 'Recoverable clicks (est)', value: Math.round(totalLostClicks).toLocaleString() },
      { label: 'Min impressions', value: effectiveMin.toLocaleString() },
    ],
    sections: [
      { type: 'note',
        text: `AI Overviews now appear on ~13% of US queries (32% of informational) and reduce CTR 30-58% at every position when present. Queries flagged here maintain visibility but lose clicks. Strategy: rewrite content to BE the AIO citation (direct answers in first 50 words, structured data, original stats).${adaptedNote}` },
      ...(cannibalized.length > 0 ? [{
        type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 cannibalized queries — recoverable clicks',
        data: { labels: cannibalized.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Recoverable clicks',
            values: cannibalized.slice(0, 15).map((r) => Math.round(((r.expectedCtr * r.impressions) - r.clicks) * 0.5)),
            color: '#a78bfa' }] }
      }] : [{
        type: 'note',
        text: totalP1Queries < 10
          ? `⚠ No cannibalization detected — but this likely just means your site doesn't have enough page-1 traffic yet. You have only ${totalP1Queries} page-1 queries with any impressions. AI Overview Cannibalization shows up once you have meaningful rankings to lose. PRIORITY: build content and earn rankings first. Use Content Gap Finder + AI Cluster to identify what to write.`
          : `⚠ No AI Overview cannibalization found. This is genuinely good news — either AIOs aren't appearing on your queries yet, or your CTR is meeting benchmarks at all positions. Re-check monthly as Google expands AIO coverage.`
      }]),
      { type: 'table', title: 'All cannibalized queries',
        columns: [
          { key: 'query', label: 'Query' },
          { key: 'confidence', label: 'AIO confidence' },
          { key: 'intent', label: 'Intent' },
          { key: 'position', label: 'Position', format: 'position' },
          { key: 'impressions', label: 'Impressions', format: 'number' },
          { key: 'ctr', label: 'Actual CTR', format: 'pct' },
          { key: 'expectedCtr', label: 'Expected CTR', format: 'pct' },
        ], rows: cannibalized },
    ],
    aiActions: ['aioStrategy'],
    rawData: cannibalized.slice(0, 20),
  };
}

function findCannibalized(current, prevMap, minImpressions) {
  return current
    .filter((r) =>
      r.impressions >= minImpressions &&
      r.position <= 10 &&
      r.position >= 0
    )
    .map((r) => {
      const prev = prevMap.get(r.keys[0]);
      const expected = expectedCtrFor(r.position);
      const ctrShortfall = expected > 0 ? (expected - r.ctr) / expected : 0;

      const positionStable = !prev || prev.position == null || r.position <= prev.position + 0.5;
      const impressionsStable = !prev || r.impressions >= prev.impressions * 0.85;
      const isInfo = isInformationalQuery(r.keys[0]);
      const shortfallStrong = ctrShortfall >= THRESHOLDS.AIO_HIGH_SHORTFALL;

      const aioConfidence =
        (shortfallStrong ? 1 : 0) +
        (positionStable ? 1 : 0) +
        (impressionsStable ? 1 : 0) +
        (isInfo ? 1 : 0);

      return {
        query: r.keys[0],
        impressions: r.impressions, clicks: r.clicks, ctr: r.ctr,
        expectedCtr: expected, ctrShortfall,
        position: r.position, positionPrev: prev?.position ?? null,
        intent: isInfo ? 'Informational' : 'Other',
        confidence: aioConfidence >= THRESHOLDS.AIO_HIGH_THRESHOLD ? 'High'
                  : aioConfidence >= THRESHOLDS.AIO_MEDIUM_THRESHOLD ? 'Medium' : 'Low',
        confidenceScore: aioConfidence,
      };
    })
    .filter((r) => r.confidenceScore >= THRESHOLDS.AIO_MEDIUM_THRESHOLD && r.ctrShortfall >= THRESHOLDS.AIO_MIN_SHORTFALL)
    .sort((a, b) => (b.confidenceScore - a.confidenceScore) || (b.impressions - a.impressions))
    .slice(0, 50);
}
