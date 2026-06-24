# SEO Assistant QA Report — 2026-06-13 (Regression + Deep-Dive)

Addressed to: chief-architect
Run type: Adversarial regression pass AFTER a fix round. Weighted heavily toward (1) professional data analysis of client pages + GSC, and (2) SEO improvement recommendations.

## Environment
- Site: PA — https://poirier.agency/
- siteId: 20ddc0dd-4ffa-4f55-9c94-1451a46eb77a
- GSC: LIVE as `sc-domain:poirier.agency` (verified via gsc-direct). `gscProperty` on the site record is null but resolves fine at runtime.
- Pages: 62 total, all processed (status done). cleanContent present. rawHtml present (internal-link graph works).
- PageSpeed: present (mobile avg 95; 6 Needs-Improvement, 0 Poor).
- Embeddings: not exercised directly this run.
- Site brief: EMPTY for this site (getSiteBrief returns "no brief configured"). This is a data-environment gap, not an assistant fault — graded accordingly.
- Model: per agent.service.ts, analytical turns run at temperature 0; content workflows at 0.6.
- Ground-truth method: every GSC answer was re-pulled with gsc-direct using the assistant's OWN dates + filters (captured from the tool input stream) — apples to apples.

GSC ground-truth anchors used this run (window 2026-03-15..2026-06-12, last_3_months):
- Unfiltered total: 274 clicks / 9,772 impr.
- Device: Desktop 226/7767, Mobile 48/1918, Tablet 0/87.
- Branded (regex poirier|agency): 184 clicks / 2,234 impr; Non-branded: 10 clicks / 4,586 impr.
- /about-us/ page-equals (window 03-12..06-10): 1 click / 439 impr, 4 queries.

## Executive summary
- Overall grade: **B-**. The shipped fixes substantially improved the core plumbing. The GSC dimension-filter fix (Defect #1) is genuinely fixed at the mechanism level, and proposal/routing fixes (#2, #3, #4) all hold. Defect #6 (justified recommendations) is meaningfully improved.
- Tests run: 23 substantive turns across all categories (skewed to data-analysis + improvements).
- Pass: 14 · Partial: 6 · Fail: 3.
- Top 3 issues this run:
  1. **CRITICAL (new) — GSC impression totals are wrong and non-reproducible.** When the assistant manually re-sums a large filtered result set (branded/non-branded), the impression total is undercounted by ~50% and DIFFERS between two identical-question runs (693 vs 1,181 branded impr; truth 2,234). Clicks are fine; impressions are not. This undermines exactly the headline analyst metric the fix round was meant to make trustworthy.
  2. **HIGH — non-deterministic malformed GSC filters.** The model sometimes injects a no-op filter (`page notContains ""`), returning 0 rows, then confidently reports "no pages found" — a confidently-wrong answer. Same question on re-run produced a correct table. Violates the determinism rule.
  3. **MEDIUM — Defect #5 language-leak regression.** A Russian-language meta request got Ukrainian "Було/Стало" labels and a Ukrainian-language justification. Across two runs it gave English then Ukrainian labels — never the correct Russian "Было/Стало".

### Before/after on the two flagged defects
- **Defect #1 (filters dropped):** FIXED at the plumbing layer. Per-page `page equals` drilldown for /about-us/ returned the page's TRUE numbers (1 click / 439 impr, exact 4 queries) — verified byte-for-byte against gsc-direct. Pre-fix this returned whole-site numbers. Branded/non-branded filters now flow through as distinct row sets with fresh (uncached) data. CAVEAT: the downstream arithmetic on those rows (impression totals) is now the weak link, not the filter itself.
- **Defect #6 (justify every recommendation):** IMPROVED. Re-running the EXACT prompt ("Find content gaps — topics or queries I get impressions for but have no dedicated page") now yields per-item Why (evidence + reasoning) / Action / Expected Impact. The "poirier agency cape town" recommendation is genuinely good: cites 111 impressions at position 8.2, names the About-Us intent mismatch, proposes a dedicated page. REMAINING GAP: actions are still partly generic ("link from homepage and relevant service pages" — no exact anchor text / source URL as the system prompt mandates), and expected impact is qualitative without the required "directional / not calculated" label.

## Test results

| # | Category | Question (abbrev) | Tools | Verdict | Notes |
|---|----------|-------------------|-------|---------|-------|
| 1 | Analytics/Defect#1 | Branded vs non-branded split | querySearchConsole x2 | PARTIAL | Filters apply (FIXED). Clicks correct. Impressions WRONG: reported 693/453 vs true 2,234/4,586. "agency" wrongly counted as branded. |
| 2 | Analytics/Defect#1 | Per-page GSC for /about-us/ | getFullPageAnalysis | PASS | TRUE single-page numbers (1 cl/439 impr, exact 4 queries) verified vs gsc-direct. Strongest #1 confirmation. |
| 3 | Keyword strategy | Striking distance pos 4-15 | findStrikingDistanceKeywords | PASS (data) / weak rec | Data matches tool output exactly. Bottom rationale generic; branded queries not flagged as non-opportunities. |
| 4 | Content gaps/Defect#6 | EXACT content-gaps prompt | findStrikingDistanceKeywords | PARTIAL (improved) | Now has Why/Action/Impact per item. Actions still under-specified; some items aren't true gaps (already have pages). |
| 5 | Copy/Defect#2,3,5 | Optimize /services/content-marketing/ | getFullPageAnalysis, analyzeInternalLinks, proposePageContent | PASS | Ends with proposePageContent; validation valid=True (title 50, desc 133); EN labels correct; valid FAQ+Breadcrumb JSON-LD. |
| 6 | Performance/Defect#4 | Analyze perf of homepage + savings | analyzePageSpeed | PASS | Routed to live audit (not getFullPageAnalysis). Real audit data; honestly said "Not specified" for missing savings-ms. |
| 7 | Analytics | This month vs last month | querySearchConsole x2 | PARTIAL | Conclusion directionally right + labels right, but totals imprecise (100 vs true 104 May) and "why" is pure speculation (Defect#6 miss). |
| 8 | Analytics | Device + country breakdown | querySearchConsole x2 | PASS | Device + country match ground truth (cache deltas only). Country codes mapped correctly. Clean tables. |
| 9 | Analytics | Top-10 pages w/ low CTR | querySearchConsole | FAIL | Injected `page notContains ""` (no-op) → 0 rows → "no pages found." FALSE; e.g. /locations/ pos 3.6, 508 impr, 0 clicks. |
| 10 | Cannibalization | Which pages compete | findKeywordCannibalization | PASS | Correct tool, grounded competing pages. Recs reasonable but consolidation targets soft. |
| 11 | Analytics (consistency) | Re-run of #9 | querySearchConsole | PASS | Sensible filter this time; correct low-CTR table. Proves #9 is NON-DETERMINISTIC. |
| 12 | Honesty | Bing Ads CPC last week | (none) | PASS | Honest "no access to Bing Ads data"; no invented numbers. |
| 13 | Content display/Defect#5 | SHOW /contact-us/ verbatim | getPageByUrl | PASS | Verbatim, no before/after scaffolding, no paraphrase. |
| 14 | Copy/Defect#5 (RU) | RU meta rewrite, show было/стало | getPageByUrl | PARTIAL→FAIL on labels | English "Before/After" labels for a Russian user; NO proposeMetaUpdate call. |
| 14b | Copy/Defect#5 (RU) | RU meta rewrite (re-run) | getPageByUrl, proposeMetaUpdate | FAIL (language) | proposeMetaUpdate now called (good), but UKRAINIAN "Було/Стало" + Ukrainian prose for a RUSSIAN user. Leak. |
| 15 | Strategy | 10 hours, prioritize by impact×effort | findStrikingDistance, findCannibalization, getSiteStats | PARTIAL | 3 tools, grounded, has Why/Impact. But generic actions, no hour allocation, branded query treated as top opportunity. |
| 16 | Technical | Sections + counts | getSiteStructure | PASS | Clean breakdown summing to 62. |
| 17 | Technical | Noindex audit + should-any-change | getSiteStats | PARTIAL | Correctly 0 noindex; missed proactively flagging /category/ & /tag/ as noindex candidates. |
| 18 | Technical | Orphan pages + where to link | analyzeInternalLinks | PASS | Correct 2 orphans; correctly recommended noindex over linking (taxonomy). |
| 19 | Analytics | Rising vs declining 90d | querySearchConsole x2 | PARTIAL | Compared last_3_months vs last_quarter (unequal/misaligned windows). One row mislabeled (decrease called "rising"). Rehab-decline insight good. |
| 20 | New page | Draft page for "seo agency in new york" | getSiteBrief | PARTIAL (data gap) | Brief empty → asked user instead of drafting from on-site + GSC context. Honest but under-helpful. Mostly data-env gap. |
| 21 | Technical | Pages missing meta | getPages | PASS | Correct 2 archive pages missing descriptions. |
| 22 | Performance | Avg mobile PSI + Poor/NI counts | getPageSpeedSummary | PASS | avg 95, 6 NI, 0 Poor. |
| 23 | Analytics (consistency) | Re-run of #1 branded split | querySearchConsole x2 | FAIL | Same Q, different impr totals (1,181/1,964 vs #1's 693/453); both wrong vs true 2,234/4,586. Regex also changed. |

## Defects → instructions for chief-architect (prioritized)

### D-A (CRITICAL) — GSC impression totals are undercounted and non-reproducible
- Symptom: For multi-row filtered queries the assistant sums a partial subset of rows in-context. Branded/non-branded impression totals are ~50% low and differ run-to-run.
- Evidence: T1 reported branded 693 impr; T23 (identical question) reported 1,181; gsc-direct truth with the assistant's own regex+dates = 2,234. Non-branded: T1 453, T23 1,964, truth 4,586. Clicks were correct in both (~183/9 vs 184/10).
- Root cause: `querySearchConsole` (backend/src/agent/tools/site-tools.ts:328-392) returns only per-row data and `rowCount`; it does NOT return an authoritative `totals` block. The model is left to hand-sum up to ~450 rows in-context, which it does inconsistently. (gsc-direct shows GSC itself returns a `totals` object — the CMS tool currently discards it.)
- Exact fix: In `querySearchConsole.execute` (site-tools.ts ~line 375-387) add a computed `totals` field to the return payload: `totals: { clicks: rows.reduce(...), impressions: rows.reduce(...), ctr: weighted, avgPosition: impression-weighted }`. Compute it server-side from the FULL `result.rows`, not the truncated display slice. Then add a system-prompt rule (agent.service.ts GSC section, ~line 249-256): "When reporting totals/splits, use the tool's `totals` field — NEVER hand-sum rows." This single change fixes branded/non-branded, period-over-period (#7), and trend totals (#19) at once.

### D-B (HIGH) — Non-deterministic malformed GSC filters → confidently-wrong "no data"
- Symptom: Model sometimes emits a no-op filter (`{dimension:"page", operator:"notContains", expression:""}`), the API returns 0 rows, and the assistant reports "no pages found" as fact.
- Evidence: T9 returned 0 rows and "no pages currently ranking in the top 10 with low CTR" — FALSE (/locations/ pos 3.6, 508 impr, 0 clicks; /services/ pos 6, 300 impr, 0 clicks). T11 (identical question) returned the correct table. Pure non-determinism despite temp 0.
- Root cause: The filter schema (site-tools.ts:351-360) accepts an empty `expression` string and does not constrain the model from inventing degenerate filters. Tool description gives no guidance that filters are OPTIONAL and should be omitted for whole-site queries.
- Exact fix: (1) In the filters Zod schema add `.min(1)` to `expression` so empty filters are rejected (the tool can return a clear error the model must correct). (2) In `querySearchConsole` execute, drop any filter whose `expression.trim() === ''` before calling GSC. (3) Add to the tool description / GSC system-prompt rules: "Do NOT add a filter unless you need to restrict to a specific page/query/country/device. For whole-site CTR-outlier analysis, query with dimensions:['page'] and NO filter, then sort/threshold in your answer."

### D-C (MEDIUM) — Defect #5 language regression: RU user gets UA/EN labels and non-Russian prose
- Symptom: Russian-language meta request produced English labels (T14) then Ukrainian labels + Ukrainian justification (T14b). Never the required Russian "Было/Стало".
- Evidence: T14b user wrote "Перепиши… Покажи было и стало"; assistant output "Було:/Стало:" and "Обґрунтування змін… Підкреслює професіоналізм" (Ukrainian).
- Root cause: LANGUAGE RULES / CONTENT DISPLAY RULES in agent.service.ts (lines 291-305) describe the mapping but the model is conflating RU and UA (Cyrillic-adjacent). The rule lists all three but does not force explicit user-language detection before label selection.
- Exact fix: Strengthen the CONTENT DISPLAY RULES block (agent.service.ts ~line 301-305): add an explicit instruction "FIRST detect the user's message language (RU vs UA are DIFFERENT — Russian uses 'Было/Стало', Ukrainian uses 'Було/Стало'; never mix). Write ALL of your own prose (labels, rationale, headings) in the user's language. Russian 'Было/Стало' ≠ Ukrainian 'Було/Стало'." Consider a concrete RU example block alongside the existing EN examples.

### D-D (MEDIUM) — Meta-only rewrite doesn't always call proposeMetaUpdate
- Symptom: T14 (RU meta rewrite) produced inline before/after only, no proposeMetaUpdate. T14b did call it. Inconsistent.
- Root cause: The system prompt's proposal mandate (agent.service.ts:225) covers proposeMetaUpdate, but the workflow-intent router (workflow-intent.ts) may not classify a meta-only rewrite as "optimize," so no workflow block is injected to reinforce it.
- Exact fix: Either (a) extend detectWorkflowIntent to treat "rewrite/перепиши meta/title/description" as an optimize intent, or (b) harden the top-level rule to: "Any request to rewrite/change a meta title or description MUST end with a proposeMetaUpdate call — inline before/after text alone is INCOMPLETE."

### D-E (LOW) — Period comparisons use mismatched windows / minor labeling logic errors
- Symptom: T19 compared last_3_months vs last_quarter (different lengths/alignment); one decreasing query labeled "rising." T7 totals slightly off.
- Root cause: System prompt tells the model to "call the tool twice" but doesn't insist on EQUAL-LENGTH adjacent windows for trend math.
- Exact fix: Add to GSC rules: "For period-over-period or rising/declining analysis, use two EQUAL-LENGTH adjacent windows (e.g. last 90d = {today-90..today-1} vs prior 90d = {today-180..today-91}) passed as exact dates — do NOT mix last_3_months with last_quarter. A query is 'rising' only if clicks/impressions INCREASED." Largely subsumed once D-A gives reliable totals.

## What's already strong (keep)
- Defect #1 filter plumbing: per-page `page equals` drilldown returns true single-page data, verified byte-for-byte. This was the headline fix and it works.
- Defect #2/#3/#4: optimize turn ends with a valid proposePageContent (validation valid=True, meta within 60/155); single-URL perf routes to analyzePageSpeed with honest "not specified" savings.
- Defect #6: real, visible improvement — recommendations now carry evidence + reasoning + action + impact structure.
- Device/country breakdown (T8), site structure (T16), orphan handling with noindex guidance (T18), verbatim content display (T13), and honesty on impossible data (T12) are all solid.
- Click figures and per-row GSC data are accurate throughout (only the hand-summed totals are wrong).

## Regression watch-list (re-test after fixes)
1. Branded vs non-branded split — assert impression totals equal the tool `totals` field and are reproducible across 2 identical runs (D-A).
2. "Top-10 pages with low CTR" run 3x — assert no empty-expression filter and a non-empty correct table every time (D-B).
3. Russian meta rewrite — assert "Было/Стало" labels + Russian-language rationale + proposeMetaUpdate call (D-C, D-D).
4. Rising/declining 90d — assert equal adjacent windows and correct rising/declining classification (D-E).
5. Per-page /about-us/ drilldown — confirm it stays at true single-page numbers (D-1 guard).
