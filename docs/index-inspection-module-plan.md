# Implementation Plan — "Google Index Inspection" module

**Status:** Discovery + Planning complete. No product code written. Awaiting approval.
**Date:** 2026-07-01
**Prepared by:** Chief Architect, synthesizing a docs/web researcher plus three advisors (SEO specialist, data analyst, UX designer) against verified reconnaissance of the actual `main` branch.

**One-line framing (all three advisors converged on this):** This is **not** an "inspect everything" tool. With a hard cap of 2,000 URL-inspections/day/property, the product *is* the prioritization policy plus honest change-detection. The daily surface is a **diff** ("what deindexed on a page that matters"), not a **dump**.

A prior "Crawl & Index Monitor" effort (per MEMORY, "built 2026-06-25") **does not exist on `main`, any branch, or git history** — confirmed independently by two subagents inspecting the disk. Its *design* is sound and is carried forward here; we build from scratch on top of the existing `gsc` module.

---

## 1. Problem statement & the questions the module answers

**Goal (user's words):** "See ALL information about what Google does with the site's pages — when a page was indexed, when Googlebot visited, what it did." Audience: an SEO specialist **and** a data analyst.

The critical discovery from research: **the questions split cleanly across three data sources of very different feasibility.** The plan's honesty depends on never letting the UI blur them.

| Question the user wants answered | Data source | Feasible? | Honesty caveat baked into the design |
|---|---|---|---|
| Is this page indexed? Why not? | URL Inspection API `coverageState`/`indexingState` | ✅ Phase 1 | `coverageState` is a **free-text string, not an enum** (verified) — versioned mapping, unknown → `unknown` fail-loud. Derive `isIndexed` from coverage membership, never `verdict==='PASS'`. |
| When did Googlebot last crawl this page? | URL Inspection `lastCrawlTime` | ✅ Phase 1 | Google's clock, may be **weeks stale**. Shown as "Google last crawled…", never merged with our freshness clock. It is Google's *last stored crawl*, **not a hit count**. |
| Which canonical did Google pick vs the one I declared? | `googleCanonical` vs `userCanonical` | ✅ Phase 1 | First-class visual diff; normalize both before comparing (scheme/www/slash/case) or you manufacture phantom conflicts. |
| Is it mobile-usable / rich-result eligible? | `mobileUsabilityResult`, `richResultsResult` | ⚠️ Phase 2 | Mobile Usability **report retired by Google Dec 2023** — API field degraded; show but don't build on it. Rich results → cross-link to Schema module. |
| How did the state change over time? (deindexation alerts) | Our own immutable inspection ledger | ✅ Phase 2 | We only know state "as of our last inspection" (sampled/rotated), not continuously. |
| **What did Googlebot actually do over time — crawl volume, by response code / bot type?** | **GSC Crawl Stats report** | ❌ **No public API** (verified by absence) | Cannot be fetched. We **deep-link out** to GSC Crawl Stats; we must NOT synthesize a fake "crawl volume" chart from `lastCrawlTime`. |
| **When did Googlebot actually hit URL X with status Y?** | **Server access logs** (reverse-DNS-verified) | ⚠️ Phase 4, hard | This CMS does not have the WordPress site's logs. Ground-truth crawl data requires a log-ingestion pipeline — deferred, with real feasibility notes. |
| Force this page to be indexed | Indexing API | ⚠️ Phase 3, best-effort | Officially **JobPosting/BroadcastEvent only**, ~200/day, service account must be **Owner**. Never a magic "index now" button. |

**Scope statement to put on the module:** this is an **index-state** module, not a crawl-volume module, until (and unless) server-log ingestion lands. All three advisors independently flagged that implying otherwise is the fastest way to lose professional trust.

---

## 2. Synthesis of research + advisor recommendations (attributed)

### From the web/API research (docs-researcher — HIGH confidence, official Google docs)
- **Endpoint:** `POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect` (note: **v1 + `searchconsole` host**, different from the `webmasters/v3` host the current `gsc.service` uses for Search Analytics). Body: `{ inspectionUrl, siteUrl, languageCode? }`. Scope `webmasters.readonly` is sufficient — **already what `gsc.service` holds**, so no new auth.
- **Quota (verified official):** 2,000/day + 600/min **per site**, AND 10M/day + 15k/min **per Cloud project**. Both ceilings apply.
- **Enums verified:** `verdict` (PASS/PARTIAL/FAIL/NEUTRAL/UNSPECIFIED); `robotsTxtState`; `indexingState` (INDEXING_ALLOWED / BLOCKED_BY_META_TAG / BLOCKED_BY_HTTP_HEADER / BLOCKED_BY_ROBOTS_TXT); `pageFetchState` (12 values incl. SOFT_404, NOT_FOUND, SERVER_ERROR…); `crawledAs` (DESKTOP/MOBILE). **`coverageState` is a string, not an enum** — the single field most likely to drift.
- **Errors:** 403 `PERMISSION_DENIED` (URL not under verified property), 429 `RESOURCE_EXHAUSTED` for quota (sometimes surfaced as 403 `quotaExceeded` on the legacy surface) — handle both.
- **Crawl Stats:** the API surface is only `searchanalytics`, `sites`, `sitemaps`, `urlInspection` — **no crawlStats/hostStatus resource exists**.
- **Indexing API:** scope `indexing`, service account must be **Owner** (not Full user), 200/day, JobPosting/BroadcastEvent only.
- **Googlebot log verification:** reverse+forward DNS, or match Google's CIDR file — **the old `googlebot.json` URL now redirects to `https://developers.google.com/static/crawling/ipranges/common-crawlers.json`**.
- **Competitor columns SEOs rely on:** indexability verdict + reason, Google-vs-declared canonical, last-crawl + crawled-as, the three blocker states, in-sitemap/referring-URLs, rich-results validity, and trend/change-over-time.

### SEO specialist advisor (voice of the practitioner) — prioritized
- **P0: Traffic-weighted rotation.** Spending 2k/day evenly across a large site is the #1 way this tool becomes useless. Priority tiers: (1) watchlist/money pages, (2) highest impressions/clicks (join existing `impact/gsc-daily`), (3) recently published/edited, (4) currently-bad/unknown re-checked more often, (5) never-inspected NULLS FIRST, (6) oldest rotation. Screaming Frog ships an explicit budget-saving toggle for exactly this reason.
- **P0: Distinct status buckets, not binary.** Crawled-not-indexed (Google quality call — no button fixes it), Discovered-not-indexed (crawl-budget/internal-links), Excluded-by-noindex (your config — fixable now) demand *different actions*, so must be different filters. Onely/Search Engine Land sources.
- **P0:** canonical conflict first-class; "Open in GSC" on every row; CSV export (analysts live in exports); no naked "% indexed."
- **P1:** segment by URL pattern / post-type ("group affected URLs to find the pattern"); act-target deep links into the existing Meta/Schema editors; saved views; adaptive re-inspection cadence; cross-link to Impact (deindexed **and** ranking-drop = top alert). Adopt Screaming Frog's filter names verbatim.
- **Agrees strongly:** keep "Request indexing" single-page only. Bulk-submitting non-indexed pages *cannot fix the cause*. The earlier instinct to decline the bulk button was correct.

### Data analyst advisor (voice of correctness) — prioritized
- **P0 (the biggest remaining risk): sampling/rotation bias in coverage-over-time.** Because you inspect ~1,500 of N pages/night on rotation, a "% indexed" trend moves when *which pages you sampled* changes — an analyst will misread that as Google deindexing. **Coverage must be computed over an explicit, stable cohort, with denominator + never-inspected count + inspection-age distribution attached to every number.**
- **P0: four timestamps per row** with explicit subject-verb ownership: `googleLastCrawlTime` (Google/UTC), `lastInspectedAt`/`dataAsOf` (us), `firstSeenAt` (us), `observedChangeAt` (us). Coverage-over-time plots on **our inspection-date axis** with carry-forward (LOCF); crawl-recency plots on Google's clock on its **own** chart.
- **P0: timezone trap** — `gsc_daily` buckets in `America/Los_Angeles` (`impact/gsc-date.ts`), but Inspection timestamps are **UTC**. Do **not** reuse `gsc-date.ts` bucketing for inspection times — dedicated helper, commented.
- **P0: one pure versioned module** (`crawl-normalize.ts`) owns `deriveStatus`/`isIndexed`/`canonicalMismatch`/`computeStateHash`/`coverageWithDenominator` — mirrors the discipline of `impact/impact-metrics.ts`, unit-tested like `impact-metrics.spec.ts`.
- **P0: store the raw API payload**, not just derived fields — so a mapping bug can be re-normalized retroactively **without re-spending quota**.
- **State-hash INCLUDES** the enums + normalized canonicals + derivedStatus + mappingVersion; **EXCLUDES** `lastCrawlTime`, `lastInspectedAt`, `referringUrls`, `sitemap` — so a fresh crawl time alone is not logged as a "change."
- **Segments:** directory/path-prefix, template/type, sitemap membership, indexability directive, canonical status, coverageState bucket, crawledAs, pageFetchState, freshness bucket. High-value cross-join with `gsc_daily`: "**has clicks but not indexed**" (data conflict) and "indexed but zero traffic."
- **Export:** every aggregate export embeds `{cohortDefinition, N inspected, M known, neverInspected, oldestAge, medianAge, property, propertyType, generatedAt, mappingVersion}` — a coverage % without its denominator + as-of is indefensible in a client meeting.

### UX designer advisor (voice of the user) — prioritized
- **IA:** new per-site sidebar item in the **"observe reality" cluster** (next to Optimization Impact / PageSpeed — *what Google actually did*), deliberately **not** next to Meta/Schemas (*what we told Google*). Label **"Index Status"** (`ScanSearch`/`Radar` icon). Routes `/sites/:id/index-status` and `/sites/:id/index-status/:pageId`, mirroring the Meta list→detail precedent.
- **P0:** two clocks never merged (separate columns in list, separate cards in detail, subject-verb labels); "Never checked" = **neutral zinc**, never red/green; "Unknown" = **loud** (violet, `animate-pulse`); no naked % (denominator + oldest-age always); quota cost shown *before* any spend ("Re-inspect selected (spends 3 of 340)"); canonical conflict as dedicated diff card; raw Google enums shown verbatim next to normalized status (the trust substrate); reuse `GscStatus` modal for the not-connected state.
- **States with concrete copy:** no-GSC, no-pages, never-scanned, loading, **partial (quota exhausted mid-scan → banner, rows keep old timestamps, never blanked)**, stale (amber age chip, not red — stale ≠ broken), error (fall back to cached + retry, never a blank screen), unknown (fail-loud with raw value + copy-JSON).
- **Reuse map (verified files exist):** `SiteMetaPage.tsx` (list scaffold), `StatusBadge.tsx`/`SyncStatusCell` (chips), `GscStatus.tsx` (connect flow), `MetaHistoryTimeline.tsx` (history/diff), `SchemaDetailPage.tsx`/`MetaEditPage.tsx` (detail layout), `Pagination.tsx`, `WpPluginStatus.tsx`.

**Conflicts resolved:**
- *Analyst wants full raw payload retention* vs *cost/size* → **store raw payload** (analyst P0 wins; it's the only way to re-normalize without re-spending quota — cheap relative to quota value). Configurable retention window later if size bites.
- *Analyst wants rich segmentation/export by default* vs *UX warns against overwhelming the default view* → **summary + money-segment by default; export and advanced segments behind secondary actions.**
- *SEO wants request-indexing* vs *UX wants it deferred (highest trust risk, least payoff)* → **defer to Phase 3, single-page-only, gated, with mandatory caveat** — satisfies both.

---

## 3. Concrete data model, API surface, frontend surface

### 3.1 Backend module: `backend/src/crawl/`
Mirrors the `impact`/`schema` module conventions (controller under `sites/:siteId/...`, `{ data }` wrapping via the global TransformInterceptor, ValidationPipe DTOs, `@Cron` in the scheduler, immutable ledger like impact's change model).

**Entities / tables** (4 tables — the locked architecture):

**`crawl_page_status`** (mutable, one row per page — fast reads)

| column | type | notes |
|---|---|---|
| `id` | uuid PK | |
| `siteId` | uuid, indexed | |
| `pageId` | uuid, nullable, FK pages | null if URL not yet in `pages` inventory |
| `url` | varchar(2048) | normalized |
| `derivedStatus` | varchar | normalized bucket (indexed / crawled_not_indexed / discovered_not_indexed / excluded_noindex / blocked_robots / canonical_alternate / redirect / not_found / soft_404 / unknown) |
| `isIndexed` | boolean **nullable** | ternary: true/false/null(never inspected) |
| `coverageStateRaw` | text | verbatim Google string |
| `verdict`,`indexingState`,`robotsTxtState`,`pageFetchState`,`crawledAs` | varchar | raw enums |
| `googleCanonical`,`userCanonical` | varchar(2048) nullable | |
| `canonicalConflict` | boolean | derived, normalized compare |
| `googleLastCrawlTime` | timestamptz nullable | **Google's clock** |
| `lastInspectedAt` (`dataAsOf`) | timestamptz nullable | **our clock** |
| `firstSeenAt` | timestamptz nullable | our clock |
| `stateHash` | char(64) | current hash |
| `mappingVersion`,`apiVersion` | int/varchar | |
| `lastRunId` | uuid FK scan_runs | |
| unique index | `(siteId, url)` | |

**`crawl_inspections`** (append-only ledger — insert only on state change)
`id, siteId, pageId, url, runId, observedAt, rawPayload jsonb (full API response), coverageStateRaw, verdict, indexingState, robotsTxtState, pageFetchState, crawledAs, googleCanonical, userCanonical, derivedStatus, stateHash, prevStateHash, isDeindexation bool, isFirstSeen bool, mappingVersion, apiVersion`. Index `(siteId, url, observedAt)`.

**`crawl_scan_runs`** (lineage — one row per run)
`id, siteId, trigger (nightly|on_demand|backfill), property, propertyType (sc_domain|url_prefix), startedAt, finishedAt, apiVersion, mappingVersion, normalizerSha, quotaBudget, quotaUsedThisRun, quotaRemainingAtStart, pagesSelected, pagesInspected, pagesSkippedQuota, pagesErrored, errorBreakdown jsonb, selectionStrategy jsonb`.

**`crawl_quota_ledger`** (atomic daily cap)
`id, siteId, property, quotaDate (date, Pacific), used int, reserved int, capDaily int (default 2000), budgetNightly int (default 1500)`, unique `(property, quotaDate)`. Reserve-then-commit so cron + on-demand can't overspend; per-minute (600) throttle enforced in the queue.

**Pure logic module `crawl-normalize.ts`** (no I/O, versioned, unit-tested): `deriveStatus(raw)`, `isIndexed(raw)`, `normalizeUrl(u)`, `canonicalMismatch(g,u)`, `computeStateHash(raw)`, `coverageWithDenominator(rows)`. Exports `MAPPING_VERSION`.

### 3.2 API surface (routes under `/api/sites/:siteId/index-status/...`)
- `GET  /index-status/summary` → distribution with denominators (N of M, never-checked, oldest/median age), quota widget data, last-run info.
- `GET  /index-status/pages?segment=&freshness=&canonicalConflict=&search=&sort=&page=` → paginated list rows.
- `GET  /index-status/pages/:pageId` → detail (status_row + latest inspection raw + history).
- `GET  /index-status/pages/:pageId/history` → ledger transitions.
- `POST /index-status/inspect` `{ pageIds[] | urls[] }` → on-demand re-inspect within remaining quota (returns quota cost + per-URL result; 429 with remaining if exhausted).
- `GET  /index-status/quota` → `{ capDaily, used, reserved, remaining, budgetNightly, resetsAt }`.
- `GET  /index-status/export?segment=&format=csv|json` → row-level export **with metadata header** (cohort, denominators, as-of, mappingVersion).
- *(Phase 3)* `POST /index-status/pages/:pageId/request-indexing` → gated single-page Indexing API call.
- Reuse existing `GET /api/gsc/site-status?siteUrl=` for the connection gate.

### 3.3 Frontend surface
- Nav item in `RootLayout.tsx` (observe-reality cluster). Routes in `App.tsx`.
- `pages/SiteIndexStatusPage.tsx` (list), `pages/IndexStatusDetailPage.tsx` (detail).
- `components/index-status/`: `FreshnessQuotaStrip`, `StatusDistributionBar` (clickable→filter), `IndexStatusChip`, `TwoClocks`, `CanonicalDiffCard`, `RawEnumTable`, `IndexHistoryTimeline` (wraps `MetaHistoryTimeline`).
- `hooks/useIndexStatus.ts` (TanStack Query).

**List view sketch** (clone of `SiteMetaPage` scaffold):
```
Sites › Poirier › Index Status                                   [◱ Open in GSC]
┌ FRESHNESS & QUOTA STRIP ─────────────────────────────────────────────────────┐
│ 340 of 412 pages inspected · oldest 14d · 24 never checked                    │
│ On-demand re-checks left today: 340 / 2,000  [▓▓▓▓░░░░]  · nightly ~200, 8h ago│
└───────────────────────────────────────────────────────────────────────────────┘
STATUS DISTRIBUTION (click a segment to filter — denominator always shown)
 ████ Indexed 212 · ██ Crawled-not-indexed 41 · █ Discovered 18 · █ Excluded 27
 ░ Never checked 24 · ▨ Unknown 4    Based on 388 of 412 · oldest 14d
[🔍 Filter URL] Segment:[All▾] Freshness:[Any▾] ☐ Canonical conflicts only
☐ URL              STATUS               GOOGLE CRAWLED  WE CHECKED  CANONICAL
☐ /services/roofing ● Indexed           3d ago          6h ago      ✓ match
☐ /blog/gutters     ◐ Crawled–not-indexed 21d ago       2d ago      ✓ match
☐ /old-promo        ⊘ Excluded (noindex) 5w ago         2d ago      ⚠ Google≠declared
☐ /new-landing      ○ Discovered–not-idx — never        1d ago      — none
☐ /draft-page       ░ Never checked      —               —          —
☐ /weird-url        ▨ Unknown status     4d ago          4d ago     —
[☑ 3 selected] → [Re-inspect selected (spends 3 of 340)]        ‹Prev 1/9 Next›
```

**Detail view sketch:**
```
Sites › Poirier › Index Status › /blog/gutters                   [◱ Open in GSC]
/blog/gutters   ◐ Crawled – currently not indexed        [Edit Meta] [Schema]
┌ GOOGLE LAST CRAWLED ─────┐  ┌ WE LAST CHECKED ─────────┐
│ 21 days ago              │  │ 2 days ago               │ [Re-inspect (1 of 340)]
│ May 20 03:14 UTC         │  │ Jun 29 02:00             │
│ Google's clock           │  │ freshness of this data   │
└──────────────────────────┘  └──────────────────────────┘
STATUS  Our: ◐ Crawled–not-indexed     ── Raw Google values ──  [copy JSON]
  verdict NEUTRAL · coverageState "Crawled - currently not indexed"
  indexingState INDEXING_ALLOWED · robotsTxtState ALLOWED
  pageFetchState SUCCESSFUL · crawledAs MOBILE
CANONICAL  Declared: …/blog/gutters   Google-selected: …/blog/gutter-guide ⚠ CONFLICT
           → [Edit Meta] to review
COVERAGE/ROBOTS/FETCH · MOBILE (retired, informational) · RICH RESULTS → [Schema]
HISTORY  ● Jun 29 Crawled–not-indexed (was Indexed) — we checked
         │ Jun 10 Indexed — we checked
Actions: [Re-inspect (1 of 340)] [Request indexing ⓘ (Phase 3)] [Open in GSC ◱]
```

---

## 4. Phased, reversible implementation plan

Guiding principle: **Phase 1 is a thin vertical slice that delivers real value** (see live index status for prioritized pages, honestly) and stands alone. Each phase is independently shippable and reversible (every migration has a real `down()`; features gate behind their route/nav item, so rollback = revert migration + remove nav entry).

### Phase 1 — Vertical slice: inspect + prioritized rotation + honest read (the money slice)
**Scope:** Extend `gsc.service` with `inspectUrl()`; the 4 tables; `crawl-normalize.ts`; nightly rotation (tiered selection, budget 1,500/day) + on-demand re-inspect within quota; list + detail views with two clocks, distinction of never-checked/unknown, denominators, canonical diff, "Open in GSC". **No** change-ledger analytics UI yet, **no** request-indexing, **no** export, **no** rich-results/mobile.
**New files (backend):** `crawl/crawl.module.ts`, `crawl.controller.ts`, `crawl-status.service.ts`, `crawl-inspect.service.ts` (shared inspect→persist, called by both cron and on-demand), `crawl-scan.service.ts` (selection + rotation), `crawl-quota.service.ts`, `crawl-normalize.ts`, entities `crawl-page-status.entity.ts` / `crawl-inspection.entity.ts` / `crawl-scan-run.entity.ts` / `crawl-quota-ledger.entity.ts`, DTOs. Extend `gsc/gsc.service.ts` with `inspectUrl()` + per-scope token cache; register `@Cron('0 1 * * *')` in `scheduler.service.ts`.
**Frontend:** nav item (`RootLayout.tsx`), routes (`App.tsx`), `SiteIndexStatusPage.tsx`, `IndexStatusDetailPage.tsx`, `components/index-status/*`, `hooks/useIndexStatus.ts`.
**Migration:** `1784000000000-AddCrawlIndexInspection.ts` (4 tables + indexes; IF NOT EXISTS; real `down()` dropping all four).
**Tests:** `crawl-normalize.spec.ts` (deriveStatus for every known coverageState string + unknown→fail-loud; isIndexed ternary; canonical normalize/compare; stateHash includes/excludes the right fields — **this is the highest-value test file**); `crawl-quota.spec.ts` (atomic reserve/commit, cap enforcement, Pacific day boundary); `crawl-inspect.service.spec.ts` (403/429 handling, raw-payload persistence, ledger-insert-only-on-change). Extend `gsc.service.spec.ts` for `inspectUrl()`.
**Rollback:** revert migration (`down()` drops 4 tables), remove nav item + routes. `gsc` module otherwise untouched. Zero impact on existing modules.
**Deliberately defer:** change analytics, crawl-stats deep-link polish, request-indexing, export, mobile/rich-results, server logs.

### Phase 2 — Change-log, coverage-over-time (honest), segments, cross-link to Impact, export
**Scope:** Surface the ledger as a **change feed** (deindexations highlighted, "was Indexed" deltas); coverage-over-time as **step/carry-forward line over a stable cohort** with cohort-size + median-age annotations (analyst P0); segment filters (path-prefix, coverageState bucket, canonical status, freshness); the **"has clicks but not indexed"** cross-join with `impact/gsc-daily`; CSV/JSON **export with metadata header**; rich-results section wired to Schema module (mobile shown as informational/retired).
**New files:** `crawl-analytics.service.ts` (coverage cohort/LOCF, distribution), `crawl-export.service.ts`, `components/index-status/{ChangeFeed,CoverageTrendChart,SegmentBar}.tsx`. Controller routes for history/summary-trend/export.
**Migration:** likely none (reads existing tables); if adding saved-views, a small `crawl_saved_views` table with `down()`.
**Tests:** `crawl-analytics.spec.ts` (LOCF cohort math, denominator correctness, never-inspected excluded from not-indexed, sampling-bias guard); export metadata-header test.
**Rollback:** remove routes/components; no destructive schema change.

### Phase 3 — Request-indexing (single-page, gated, best-effort) + adaptive cadence + alerts
**Scope:** Single-page "Request indexing" via Indexing API — **requires 2nd OAuth scope `indexing` + service account added as Owner** (decision D5). Gated: disabled for noindex/robots-blocked/404/redirect/canonical-alternate; mandatory caveat copy; confirm dialog; logged to `ActionLog`; separate ~200/day quota ledger. Adaptive re-inspection cadence (unhealthy/unknown checked more often). In-app deindexation alerts (money page leaves index) — email/notification.
**New files:** extend `gsc.service` with `requestIndexing()` + `indexing`-scope token cache; `crawl-alerts.service.ts`; alert config in settings. Migration for an indexing-quota ledger + alert prefs (with `down()`).
**Rollback:** feature-flag the button off; revert migration.
**Note:** Kept single-page-only — both SEO and UX advisors agree; bulk submission cannot fix the underlying cause.

### Phase 4 — Server-log ingestion (the only ground truth for "what Googlebot actually did")
**Scope (hard, exploratory — gate on a feasibility spike first):** ingest the WordPress site's access logs; verify Googlebot via reverse+forward DNS and/or the CIDR file (`common-crawlers.json`); reconstruct real crawl frequency, response-code distribution, orphan/crawl-trap detection; join logs × inspection. **Real feasibility question to resolve before committing (D6):** how does this CMS obtain the logs? Options: (a) a WP plugin endpoint that ships access logs (heavy, PII/size concerns), (b) manual upload (Screaming Frog model — simplest MVP), (c) CDN log export (Cloudflare/R2 — you already use R2 for image optimization, so an R2 log bucket is plausible). Recommend starting with **(b) manual upload** to prove value, then **(c) CDN/R2 pipeline**.
**Crawl Stats:** even here, the **aggregate GSC Crawl Stats report has no API** — provide a **deep-link out** to it; never fake the chart.
**Rollback:** entirely additive, separate tables/module; drop if abandoned.

**Build now vs defer:** Build Phase 1 in full (it's the whole user-visible value and the honesty foundation). Phase 2 is the analyst payoff and should follow quickly. Phases 3–4 are opt-in, higher-risk/lower-certainty, and explicitly gated on decisions below.

---

## 5. Open questions / decisions (with recommendations)

1. **Denominator source `M` (defines every coverage %).** Sitemap, a crawl, or the CMS `pages` table? → **Recommend: the `pages` table** as inventory `M` for v1 (it's your managed universe; already how Meta/Schema scope pages). Note in the UI that coverage is "of pages the CMS manages."
2. **"Money page" / watchlist concept** for priority tier 1 — does one exist? Recon shows `pages.isTransactional` (boolean) already exists. → **Recommend: use `isTransactional` as tier-1 in Phase 1**, add an explicit per-page "watch" flag in Phase 2 if needed.
3. **Property type per site** (sc-domain vs URL-prefix) — must be stored per run (affects canonical semantics + URL joins). → **Recommend: capture `propertyType` on every `crawl_scan_runs` row** via the existing `resolveProperty()`, which already distinguishes them.
4. **Raw-payload retention** (enables retroactive re-normalization without re-spending quota) vs storage size. → **Recommend: store full raw payload** in `crawl_inspections` (analyst P0); revisit a retention window only if size becomes a real problem.
5. **Indexing API in v1?** Needs 2nd scope + service account promoted to **Owner**. → **Recommend: defer to Phase 3, single-page-only, gated.** Ship "re-inspect only" first. (Both SEO + UX advisors agree.)
6. **Server logs — how does the CMS get them?** → **Recommend: defer to Phase 4; start with manual upload MVP, then a CDN/R2 export pipeline** (you already operate R2). Run a feasibility spike before committing.
7. **Analyst delivery:** CSV enough, or scheduled/queryable exports? → **Recommend: row-level CSV/JSON with a defensible metadata header in Phase 2**; scheduled exports only if requested.
8. **Nightly quota split:** the 2,000/day is per-property — is it shared with any future GSC-API feature? → **Recommend: budget 1,500 nightly, reserve 500 for on-demand**, enforced atomically in `crawl_quota_ledger`, and make the quota widget show the shared remaining figure so nothing double-spends.

---

## Key reconnaissance facts this plan relies on (verified on `main`)
- Reuse-not-fork: `backend/src/gsc/gsc.service.ts` already holds `webmasters.readonly`, `resolveProperty()` (sc-domain vs URL-prefix), and a token cache — inspection needs **no new auth**; add `inspectUrl()` alongside `query()`. The Inspection endpoint is `v1`/`searchconsole` host (different from the `webmasters/v3` Search-Analytics host).
- Conventions to mirror: controller `@Controller('sites/:siteId/impact')` under global `/api`; migrations are raw-SQL `IF NOT EXISTS` with real `down()` (`backend/src/migrations/`, next id `1784000000000`); cron via `@nestjs/schedule` in `backend/src/scheduler/scheduler.service.ts`; pure-metric discipline in `backend/src/impact/impact-metrics.ts`; **do not** reuse `impact/gsc-date.ts` LA bucketing for UTC inspection timestamps.
- Frontend precedent: list→detail pattern (`frontend/src/pages/SiteMetaPage.tsx` → `MetaEditPage.tsx`), nav in `frontend/src/layouts/RootLayout.tsx`, reusable `GscStatus.tsx`, `StatusBadge.tsx`, `MetaHistoryTimeline.tsx`, `Pagination.tsx`.
- `pages` table already carries `url`, `canonical`, `indexDirective`, `isTransactional`, `noindex` — usable for inventory, priority, and canonical-conflict comparison.

**Recommendation:** approve **Phase 1** to build now, treating Phases 2–4 as sequenced follow-ups gated on decisions D1–D8 above.
