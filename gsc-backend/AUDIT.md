# SEO RULES AUDIT — what changed and why

This version of the tool incorporates a critical review of every SEO rule, threshold, and AI prompt. Here's what changed:

## CTR benchmarks updated for 2026 SERPs

The "expected CTR by position" table was recalibrated using:
- First Page Sage 2026 meta-analysis
- Backlinko 4M-result study (~27.6% at position 1)
- Ahrefs Feb 2026 AI Overview impact study
- Seer Interactive 2026 follow-up

**Old vs new expected CTR table:**

| Position | Old | New | Why |
|---|---|---|---|
| 1 | 28.0% | 27.5% | More conservative — matches Backlinko |
| 2 | 16.0% | 15.5% | Same |
| 3 | 11.0% | 10.0% | Slightly lower for AIO presence |
| 4 | 8.0% | 7.0% | |
| 5 | 6.0% | 5.0% | |
| 6 | 5.0% | 3.5% | Position 6-10 dropped more in 2026 |
| 7 | 4.0% | 2.5% | |
| 8 | 3.0% | 2.0% | |
| 9 | 2.5% | 1.6% | |
| 10 | 2.2% | 1.3% | |

## CTR upside calculation now realistic

**Old:** Potential clicks = `(expectedCTR - actualCTR) × impressions`
**New:** Potential clicks = `(expectedCTR - actualCTR) × impressions × 0.5`

Why: real A/B tests of title rewrites typically capture **50% or less of the theoretical gap**, not 100%. The old math over-promised upside.

## Underperformance threshold added

Old: any query below benchmark CTR was flagged. **New: only queries below 70% of benchmark are flagged.** Queries close to benchmark already don't benefit much from rewrites.

## Content gaps no longer overlaps with CTR opportunities

**Old:** Content Gap Finder default `minPosition = 8` (positions 8-10 are still page 1)
**New:** `minPosition = 11` (page 2+ only)

This eliminates the overlap with CTR Opportunities (page 1 queries). Now:
- **CTR Opportunities** = page 1 queries (pos 1-10) with bad CTR → rewrite title/meta
- **Content Gaps** = page 2+ queries (pos 11+) with impression demand → create/improve content

## Tier classification for content gaps

Each gap is now classified:
- **Near-miss** (pos 11-15) — usually fixable with on-page tweaks + internal linking
- **Stretch** (pos 16-30) — needs content depth improvements
- **Long-term** (pos 31+) — usually needs a new dedicated page or topical authority

AI prioritizes Near-miss queries as "quick-win" clusters first.

## Winners & Losers noise filter

**Old:** Any item with any click change appeared. Including items going 0→0.
**New:** Filters require either:
- Both periods have ≥5 clicks combined, OR
- The change is ≥10 clicks for new items (previously 0 clicks)

Also caps percentage delta at ±999% so 1→100 doesn't display as 9900%.

## AI prompts now SEO-specialist grade

Each prompt was rewritten to embed 2026 SEO knowledge:

### Title rewriter
- **Strict** 50-60 char title (Google truncates at ~600px)
- **Strict** 140-155 char meta (Google truncates at ~155 desktop, ~120 mobile)
- Requires 3 distinct angles: Specificity, Benefit, Authority
- AI Overview awareness — adds direct answers to titles for informational queries (earns AIO citation)
- Banned vague openers ("Best", "Top", "Ultimate" without specifics)

### Drop diagnosis
Now references specific algorithm history:
- March/August/November 2024 Core Updates
- March/August 2025 Core + Spam Updates
- AI Overview rollout timeline
- Site Reputation Abuse policy
- Helpful Content System integration

Each hypothesis must specify category: algorithmic, ai_overview, ranking, serp_feature, seasonality, cannibalization, technical, intent.

### Query clusterer
- Each cluster classified by intent (informational, commercial, transactional, navigational)
- AI Overview risk flagged per cluster
- Quick-win vs long-play priority labels
- Filters out brand queries and thin clusters

## SITE_DESCRIPTION env var (NEW)

Every AI call now receives a site context from the `SITE_DESCRIPTION` env var. Without it, AI suggestions are generic. With a good description (business model, products, audience, price points), suggestions become specific to your business.

This is the **single biggest quality lever** for AI output. Set it.

## Default values reviewed

| Report | Param | Old | New | Why |
|---|---|---|---|---|
| Content Gaps | minImpressions | 500 | 300 | Page 2 queries earn fewer impressions |
| Content Gaps | minPosition | 8 | 11 | No overlap with CTR opps |
| Content Gaps | maxPosition | (none) | 50 | Beyond pos 50, Google barely shows you |
| CTR Opps | (no changes to defaults) | - | - | Existing defaults still correct |
| Winners/Losers | (added MIN_BASELINE_CLICKS) | 0 | 5 | Noise reduction |

## What was NOT changed and why

- **3-day lag** for "current period" data: still correct. GSC's `final` dataState already excludes ~1-2 days; adding 1-2 more eliminates jitter from late-arriving data.
- **searchType = 'web'**: still correct. Image/Video/News are different reports.
- **dataState = 'final'**: still correct. Using `all` would include unfinalized data that fluctuates daily.
- **Year-over-year = 365 days back**: leap years cause a 1-day shift, but it's negligible compared to natural data variance.
- **GSC API quota usage**: each report uses 2-8 queries. Well under the 1,200/min quota.
- **Mock data**: still useful for UI development. Not changed to "more realistic" because mock isn't meant to drive real decisions.

## Verification

All changes were tested in mock mode. To verify on YOUR site after deploying:

1. Generate the CTR Opportunities report. Check that the "Realistic upside" scorecard makes sense (should be modest, not 10× too high).
2. Generate the Content Gap Finder report. Check that all positions in the table are ≥ 11.
3. Generate Winners & Losers. Check that no items show 0 clicks in both periods.
4. Generate any report with AI on, click "AI Executive Summary". Output should mention your business (not generic SEO platitudes) if SITE_DESCRIPTION is set.
