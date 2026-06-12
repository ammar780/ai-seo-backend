// src/reports/ai-overview-impact.js
//
// AI Overview Cannibalization Detector — the #1 SEO issue of 2025-2026.
//
// Identifies queries where the site maintains good position but CTR has
// collapsed. These are likely AI Overview footprint candidates.
//
// All constants live in src/seo-constants.js (shared with ctr-opportunities).

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

  const cannibalized = current
    .filter((r) =>
      r.impressions >= minImpressions &&
      r.position <= 10 &&
      r.position >= 0   // include featured snippets (position 0) — AIO often kills them too
    )
    .map((r) => {
      const prev = prevMap.get(r.keys[0]);
      const expected = expectedCtrFor(r.position);
      const ctrShortfall = expected > 0 ? (expected - r.ctr) / expected : 0;

      const positionStable = !prev || prev.position == null || r.position <= prev.position + 0.5;
      const impressionsStable = !prev || r.impressions >= prev.impressions * 0.85;
      const isInfo = isInformationalQuery(r.keys[0]);
      // Continuous signal contributions (Bayesian-ish), not pure 0/1
      const shortfallStrong = ctrShortfall >= THRESHOLDS.AIO_HIGH_SHORTFALL;

      const aioConfidence =
        (shortfallStrong ? 1 : 0) +
        (positionStable ? 1 : 0) +
        (impressionsStable ? 1 : 0) +
        (isInfo ? 1 : 0);

      return {
        query: r.keys[0],
        impressions: r.impressions,
        clicks: r.clicks,
        ctr: r.ctr,
        expectedCtr: expected,
        ctrShortfall,
        position: r.position,
        positionPrev: prev?.position ?? null,
        intent: isInfo ? 'Informational' : 'Other',
        // 4/4 = High, 3/4 = Medium, lower not surfaced
        confidence: aioConfidence >= THRESHOLDS.AIO_HIGH_THRESHOLD ? 'High'
                  : aioConfidence >= THRESHOLDS.AIO_MEDIUM_THRESHOLD ? 'Medium' : 'Low',
        confidenceScore: aioConfidence,
      };
    })
    .filter((r) => r.confidenceScore >= THRESHOLDS.AIO_MEDIUM_THRESHOLD && r.ctrShortfall >= THRESHOLDS.AIO_MIN_SHORTFALL)
    .sort((a, b) => (b.confidenceScore - a.confidenceScore) || (b.impressions - a.impressions))
    .slice(0, 50);

  const highConf = cannibalized.filter((r) => r.confidence === 'High').length;
  // Recoverable upside is HALF the gap (AIO presence caps full recovery)
  const totalLostClicks = cannibalized.reduce((s, r) => {
    const expectedClicks = r.expectedCtr * r.impressions;
    return s + Math.max(0, (expectedClicks - r.clicks) * 0.5);
  }, 0);

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
      { label: 'Min impressions', value: minImpressions.toLocaleString() },
    ],
    sections: [
      { type: 'note',
        text: 'AI Overviews now appear on ~13% of US queries (32% of informational) and reduce CTR 30-58% at every position when present. Queries flagged here maintain visibility but lose clicks — Google shows you, but users find their answer in the AIO without clicking. Strategy: rewrite content to BE the AIO citation (direct answers in first 50 words, structured data, original stats). Recoverable upside above assumes 50% of the gap is reclaimable (the rest is permanently capped by AIO presence). For high-confidence queries, also bid for branded paid traffic to recapture intent.' },
      { type: 'chart', chartType: 'bar', orientation: 'horizontal', title: 'Top 15 cannibalized queries — recoverable clicks',
        data: { labels: cannibalized.slice(0, 15).map((r) => r.query),
          series: [{ name: 'Recoverable clicks',
            values: cannibalized.slice(0, 15).map((r) => Math.round(((r.expectedCtr * r.impressions) - r.clicks) * 0.5)),
            color: '#a78bfa' }] } },
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
