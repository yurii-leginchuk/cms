# Implementation Plan — "Technical SEO Site Audit" module

**Status:** Decisions **D1–D14 LOCKED 2026-07-02** (owner accepted every recommendation in §6 verbatim). **Phase 1 implemented** on branch `feat/tech-audit-module` (run engine, 4 tables, 7 P0 detectors, Mon-05:00-ET cron + Run-now, Site Audit UI with diff hero + mute/accept + honest states). Phases 2–5 not started.
**Date:** 2026-07-02 (decision lock + Phase 1 build)

> **Locked decisions (2026-07-02):** D1 Monday 05:00 America/New_York · D2 full page inventory + 50 live fetches/site budget · D3 `pages` table as the denominator ("of pages the CMS manages") · D4 fingerprint identity rules frozen at v1 in `audit-fingerprint.ts` before the migration · D5 per-fingerprint persistent mute + accept-as-intended, auto-resurface on worsening (severity rises or affected set grows >50%) · D6 deterministic severity authoritative, AI `suggestedSeverity` stored separately (±1 tier, Phase 3) · D7 Run-now allowed with a 1/hour per-site cooldown · D8 dashboard-only alerts in Phase 1 (`notifyEmail` reserved) · D9 no health score in v1 · D10 hybrid freshness with per-axis as-of labels · D11 hreflang auto-detect (Phase 2) · D12 CrUX-field-only CWV basis (Phase 2, see open note) · D13 one open Asana task per fingerprint (Phase 3) · D14 minimal cross-site dashboard in Phase 4.
>
> **Still open (does NOT affect Phase 1):** whether Phase 2 keeps CWV detector #11 as a *reader* over the existing `crux`/`pagespeed` modules (CrUX field decides, PSI diagnoses, deep-link to `/sites/:id/pagespeed`, no new collection) or drops #11 entirely — owner to decide before Phase 2.
**Prepared by:** Chief Architect, synthesizing web research (2025–2026 technical-SEO auditing) plus three advisors (SEO specialist, data analyst, UX designer) against verified reconnaissance of the actual `main` branch.

**One-line framing (all three advisors converged on this):** This is **not a new crawler and not a checklist tool** — it is a **weekly regression-diff engine** that reads the data the CMS already trusts (nightly-parsed pages, the crawl/index ledger, the redirect audit, the schema/ALT/CrUX/PageSpeed modules, GSC), adds a small bounded set of live fetches for the axes nobody covers (robots.txt, sitemap health, HTTPS/cert, duplicate meta, hreflang, broken links), and pages a human **only on change**. The Monday-morning surface is the **diff** ("what regressed this week"), not a wall of warnings. If the audit re-derives verdicts that dedicated modules already own, it becomes a slower, conflicting second opinion and dies of distrust by week three.

---

## 1. Problem statement & the questions the module answers

**Goal (user's words):** a scheduled technical audit of each client site covering "the things MOST important for SEO," running **once a week, Sunday night → Monday, America/New_York**, with **AI analysis** (severity, root cause, prioritization, plain language), a **findings report with run-to-run history/diffing** (new / resolved / persisting), an **AI-drafted, human-approved Asana task** per finding, and **deep links into the CMS module that can fix it** when one exists.

| Question the SEO wants answered Monday morning | How this module answers it |
|---|---|
| Did anything break this week that will cost rankings/traffic? | P0 **regression detectors** fire on *deltas* vs. last run (noindex leak, robots.txt disallow, sitemap broken, money page 404/soft-404, HTTPS/cert, canonical hijack). |
| What hygiene debt exists and what do I fix first? | P1 detectors, sorted by **GSC impact (clicks/impressions at risk) × effort**, each with evidence and a fix path. |
| Did my fixes from last week actually land? | The diff marks findings **resolved** only when *verified absent in a complete re-check* — the closed loop that makes the tool believable. |
| Who fixes it and how? | Per finding: **[Fix in CMS]** deep-link (Meta / Schemas / Redirects / ALT / Index Status, pre-filtered) and/or **[Create Asana task]** — AI-drafted, human-edited, then created via the existing Asana module and linked back to the finding. |
| Is this alarm real? | Every finding carries a **verbatim evidence envelope** (source, value, date window, sample size) via the existing `evidenceFor()` discipline; AI narration quotes server values, never invents them. |

**What this module is NOT** (scope fence, see §8): not a cloaking/hack detector (the planned security module owns Googlebot-vs-user comparison), not an index-state inspector (the crawl module owns GSC URL Inspection), not a redirect validator (the redirect module owns its engine — the audit *surfaces* its issues), not an uptime monitor, not a content-quality/E-E-A-T or backlink tool.

---

## 2. Research — what actually matters to check in 2025–2026 (prioritized check catalog)

Method: web research against Google Search Central documentation and reputable industry sources, cross-checked with the SEO-specialist advisor and with what data this CMS already holds. Client sites here are **small-to-mid (~50–2,000 pages)** — that context ruthlessly reorders the classic checklist (e.g., crawl budget is a non-issue below ~10k pages, per Google's own thresholds).

### 2.1 P0 — regression alerts ("prevents disasters"; fire on DELTA vs last run, never on steady state)

These are the checks whose failure erases traffic in days. They page a human only when the state *changed* — a page that has been intentionally `noindex` for a year is configuration, not an alert.

| # | Check | Why it's P0 | Data source | False-positive guard | Fix path |
|---|---|---|---|---|---|
| 1 | **Indexability regression** — previously-indexable page (esp. with GSC clicks) now has `noindex` (meta or `X-Robots-Tag` header) | The classic "staging config shipped to prod" disaster; noindex drops the page from Google entirely ([Google: block indexing](https://developers.google.com/search/docs/crawling-indexing/block-indexing)) | stored `pages` (nightly parse) + live re-verify of suspects; cross-check `crawl_page_status` | Honor `page.indexDirective`/`noindex` as **intent** — only fire when an indexable page *newly* goes noindex | **Meta editor** (robots tri-state) |
| 2 | **robots.txt regression** — new `Disallow` covering trafficked paths; robots.txt now 5xx/unreachable | robots.txt 5xx makes Google throttle crawling; a broad Disallow blocks discovery sitewide ([Google: robots intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro)). Also: pages blocked by robots.txt can't have their `noindex` seen — a conflict worth flagging | live fetch (1/site/run) + stored previous copy → **diff** | Diff-based, never naive string alarm; whitespace/comment changes ignored | Task (robots.txt is theme/server-side) |
| 3 | **Sitemap broken** — 404/5xx/empty/XML parse error/wrong host | The CMS page inventory AND Google's discovery both depend on it; scraper already tombstone-guards an empty fetch but nothing *alerts* | live fetch (reuses `scraper.fetchSitemapUrls` plumbing) | Distinguish transient fetch error (retry, mark run partial) from confirmed 404/empty | Task; deep-link "Resubmit sitemap" on Index Status |
| 4 | **Money-page availability regression** — transactional/GSC-clicked page now 4xx/5xx or newly missing from sitemap, **with no covering 301** | Direct traffic loss; Google's Dec-2025 rendering clarifications stress correct status codes ([status codes overview](https://www.digitalapplied.com/blog/technical-seo-audit-checklist-guide-2026)) | stored `pages.missingFromSitemapAt` + live status probe of suspects + redirect graph (`redirect-resolve`) | Intentional retirement *with* a live 301→200 is silence, not an alert | **Redirects** page (create redirect) or task |
| 5 | **Soft-404 suspicion on a trafficked page** — 200 but empty/error-templated content | Wastes crawl budget and gets pages silently dropped ([SEJ: 404 vs soft 404](https://www.searchenginejournal.com/technical-seo/404-vs-soft-404-errors/)); detection is heuristic (title "not found"/thin body/404-template similarity — the standard tool heuristics) | stored `rawHtml`/`contentStructure` + probe of a known-nonexistent URL to fingerprint the site's 404 template | Always labeled **suspicion**, never a hard alert; cross-check `crawl_page_status.pageFetchState = SOFT_404` (Google's own verdict) when available | Task; deep-link Index Status |
| 6 | **HTTPS / certificate regression** — cert expired or expiring <14 days, HTTP no longer 301→HTTPS, *sitewide* mixed content | Trust + ranking baseline; a dead cert is a full outage in Chrome | live fetch: homepage over http:// and https://, TLS cert inspection | A single insecure asset on one page is **P1**, not sitewide P0 | Task |
| 7 | **Canonical regression on money pages** — canonical newly points off-site or to an unrelated page (e.g., homepage) | Canonical consolidates all signals to the target ([Google: consolidate duplicate URLs](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls)); a bad deploy that canonicals everything to `/` deindexes the site slowly | stored `pages.canonical` diff vs last run; cross-check crawl module's Google-selected canonical | Normalize before compare (reuse `redirect-normalize`/`crawl-normalize` discipline); legit cross-domain syndication canonicals are mutable-accepted | **Meta editor** (canonical field) |

### 2.2 P1 — weekly hygiene (important; sorted by GSC-impact × effort, surfaced but never paging)

| # | Check | Why it matters | Data source | False-positive guard | Fix path |
|---|---|---|---|---|---|
| 8 | **Duplicate / missing / truncated titles & meta descriptions** | Duplicates cause cannibalization and forfeit SERP control — Google now rewrites ~76% of weak titles ([Semrush: duplicate titles](https://www.semrush.com/blog/duplicate-title-tags/)) | stored `metaTitle`/`metaDescription` — pure in-DB dedupe, zero fetches | Templated near-duplicates flagged as one **collision group**, not N findings | **Meta editor** (per page), AI meta generation exists |
| 9 | **Redirect issues** — chains >2 hops, loops, duplicates, 302-where-permanent | Google follows ~10 hops but recommends ≤3 ([SEL: too many redirects](https://searchengineland.com/guide/too-many-redirects), [Google: site moves](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes)); chains dilute signals + slow LCP | **read `RedirectValidateService.getIssues()` — do NOT re-implement** | The redirect module's engine is authoritative; the audit only surfaces counts + top items | **Redirects** page |
| 10 | **Structured-data errors** on managed schema types | Rich-result eligibility; schema errors kill eligibility silently | **read schema module** validation state | Only *errors* (not Yoast-style warnings); foreign schema labeled by source | **Schemas** page |
| 11 | **Core Web Vitals poor field data** on high-traffic pages | Confirmed ranking signal within page experience; thresholds LCP ≤2.5s, INP ≤200ms, CLS ≤0.1 ([Google: CWV & search](https://developers.google.com/search/docs/appearance/core-web-vitals)) | **CrUX field data** (`crux` module) decides; PSI (`pagespeed` module) only diagnoses | **Never alert on lab-only failure when field passes** — the classic noise experienced SEOs ignore | **PageSpeed** page; fix is task-only |
| 12 | **Broken internal links** — links in `contentStructure` pointing to 4xx/redirect-chain targets | Lost equity + UX; among the most common issues on real sites | stored link graph + statuses already known to `pages`/redirect modules; small live budget for unknown targets | External links deferred (P2); one finding per *target*, not per occurrence | **Redirects** (create) or Meta/content task |
| 13 | **Sitemap hygiene** — sitemap lists noindexed / 404 / redirected / non-canonical URLs; `lastmod` uniform-stamped | Mixed signals waste crawl visits and erode sitemap trust ([Google: crawl budget](https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget) lists outdated sitemaps as waste) | stored sitemap membership × `pages` fields — in-DB join | `lastmod` check is informational unless uniformly stamped | Task (sitemap is generated WP-side) |
| 14 | **404-template calibration probe** — fetch a guaranteed-nonexistent URL; if it returns 200, the site soft-404s *everything* | One config error makes every removed page a soft 404 | 1 live fetch/site/run | none needed — deterministic | Task |
| 15 | **hreflang errors** — missing return links, invalid ISO codes, canonical/hreflang conflict | 67% of multilingual sites get it wrong; broken hreflang is ignored *entirely* by Google ([SEJ: hreflang mistakes](https://www.searchenginejournal.com/common-hreflang-tag-mistakes/455073/)) | stored `rawHtml` head parse | **Gate: only runs if hreflang is actually present** — "no hreflang" on a monolingual site is NOT a finding | Task |
| 16 | **Missing/duplicate H1, thin-content suspicion** | Weak document structure; thin pages drag quality | stored `h1Text`/`contentStructure` | Low severity; word count is a hint, not a verdict | Meta/content task |
| 17 | **Page-level mixed content** — single `http://` asset on an HTTPS page | Browser warnings, partial blocking | stored `rawHtml` scan | Sitewide version is P0 #6; page-level stays P1 | Task |
| 18 | **ALT coverage gap** | Accessibility + image search | **read ALT module coverage** — never recompute | ALT module's decorative-image logic is authoritative | **Image ALT** page |
| 19 | **Orphan pages** (no inbound internal links) — low-confidence advisory | Orphans are invisible to crawlers except via sitemap | stored `contentStructure` link graph | Our graph is sitemap-scoped ⇒ "orphan" ≠ ground truth; labeled advisory | Content/task |

### 2.3 P2 — informational only (never "problems")

| # | Check | Stance |
|---|---|---|
| 20 | **llms.txt presence / AI-crawler access** (GPTBot, ClaudeBot, OAI-SearchBot, Claude-SearchBot, PerplexityBot allowed/blocked in robots.txt) | **Informational panel, never a finding.** Google Search ignores llms.txt and doesn't plan to support it ([SEJ](https://www.searchenginejournal.com/google-says-llms-txt-is-purely-speculative-for-now/577576/), [SERoundtable](https://www.seroundtable.com/google-does-not-endorse-llms-txt-40789.html)); measured llms.txt bot traffic is statistically negligible. Blocking training crawlers is an *agency policy choice*, so we report state neutrally. |
| 21 | **Crawl-budget / page-depth signals** | **Suppressed below ~10k URLs** — Google's own thresholds are 1M+ pages (weekly-changing) or 10k+ (daily-changing) ([Google: crawl budget](https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget)). Showing "crawl depth 5" on a 300-page site is noise dressed as insight. |
| 22 | **OG/social completeness, favicon, viewport meta** | Low-value polish; Meta editor already manages OG. |
| 23 | **www/non-www + trailing-slash + case consistency** | One-time config; check once, then only on change. |

**Deliberately excluded from the catalog** (owned elsewhere or out of scope): index state per Google (crawl module, nightly), Google-selected-canonical conflicts (crawl module), cloaking/Googlebot-vs-user divergence (planned security module), redirect-rule validation internals (redirect module), image weight/format (optimization module), content quality/E-E-A-T, backlinks, rankings (impact module).

### 2.4 Research notes with lower confidence (flagged, not load-bearing)
- Several 2026 industry posts claim Google tightened "good" LCP to 2.0s and elevated INP's weight (single-source blogs, no Search Central citation found). The plan uses the **official documented thresholds** (2.5s / 200ms / 0.1) and treats tightening claims as unverified.
- A "December 2025 Rendering Update" (non-200 pages excluded from the rendering pipeline) is reported by industry checklists; it reinforces checks #4/#5 but nothing in the design depends on it.

---

## 3. Synthesis of advisor recommendations (attributed)

### SEO specialist advisor (voice of the practitioner) — prioritized
- **P0 (the reframing): 80% read-over-existing-data, not a new crawler.** `pages` already stores `rawHtml`, `metaTitle/Description`, `h1Text`, `canonical`, `indexDirective`/`noindex`, `detectedSchemas`, `contentStructure` (links), `missingFromSitemapAt`, `isTransactional`, `lastScrapedAt`. Redirect/schema/crawl/CrUX modules own their verdicts. Live fetches are a small bounded set: robots.txt, sitemap, homepage/HTTPS, 404-probe, P0-suspect re-verification (model: `SchemaQcService.fetchLive()` cache-busted re-check).
- **P0: delta-triggered alerting, not state-triggered.** Otherwise Monday is a wall of intentional config and the tool is ignored within two weeks.
- **P0: stable finding fingerprint** (`checkId + scope + subject`) so new/resolved/persisting is reliable; **provenance via `evidenceFor()`** on every finding; **"checked N of M" honesty** — a half-crawl reporting "0 issues" is a lie.
- **P0: every finding must have an outcome** — Fix-in-CMS deep link or Asana task; never "now you know."
- **P1:** prioritize hygiene findings by GSC clicks/impressions at risk × effort; trust CrUX over PSI; gate hreflang on multilingual; suppress crawl-budget checks for small sites; llms.txt informational only.
- **AI-drafted Asana task must contain:** title = problem+scope; affected URLs with verbatim evidence; why-it-matters quantified from GSC; **acceptance criteria** (the most-skipped field — without it the task is un-closeable); suggested fix steps split CMS-editable vs dev; back-links to finding + live URL; severity.

### Data analyst advisor (voice of correctness) — prioritized
- **P0 (the #1 trap): do NOT copy `redirect-audit.service.ts` auto-resolve verbatim.** It resolves any finding not seen this run — safe there because the full redirect set is always fully analyzed, **wrong here** because a crawl has timeouts/partial coverage. A finding may be marked `resolved` **only if its subject was covered by a complete detector pass this run AND the condition is gone** (`resolutionBasis: 'verified_absent'`). Subjects not re-evaluated stay `open` + computed `unconfirmed`, never resolved.
- **P0: finding identity ≠ observed value.** Key on `sha256(checkType : subjectKey [: discriminator])` — e.g., duplicate titles keyed on the *normalized-title collision hash* with member URLs stored as mutable evidence; redirect chain keyed on chain head, not the hop list. Otherwise trivial edits cause resolve→recreate flapping that destroys diff, mute persistence, and task dedupe.
- **P0: per-detector coverage ledger on every run** (`subjectsSelected/Evaluated/Errored/TimedOut`, `scopeComplete`) — auto-resolve permitted only for detectors with `scopeComplete === true`.
- **P0: store the raw signal each detector consumed, append-only, verbatim** (status, headers incl. `X-Robots-Tag`, meta robots, canonical, title, hreflang set, robots.txt/sitemap slices) + `detectorVersion` per finding/run — mirrors `crawl_inspections.rawPayload` + `MAPPING_VERSION`; makes severity and AI interpretation re-derivable without re-crawling.
- **P0: single source of truth** — noindex/canonical-per-Google/soft-404/redirect verdicts are *consumed from* crawl + redirect ledgers, never recomputed by a second fetcher.
- **P1:** scope-signature per run + **discontinuity markers** on any trend when scope/detector-version changes (the sampling-bias guard); pure deterministic `diff()` function (clone `redirect-diff.ts` discipline) with `unconfirmed` as a first-class bucket; GSC enrichment windows via `impact/gsc-date.ts` — **not** `toISOString().slice(0,10)` (the UTC off-by-one bug present in `redirect-audit.service.ts:603`, do not copy); status model `open|resolved|deferred|muted` + computed `unconfirmed`/`regressed` + `regressionCount`; denominators inline everywhere.
- **P1: client-facing CSV leads with a provenance header** (site/property, run id + ET timestamps, detector versions, coverage, GSC window in LA time + as-of lag, and the two honesty notes: weekly snapshots miss intra-week revert-and-return; "resolved" = verified absent in a complete re-check).
- **P2:** `isSignificant()` small-sample guard before GSC traffic moves a finding's rank; time-to-resolve/recurrence metrics; severity provenance (deterministic tier vs AI-adjusted) kept separable.

### UX designer advisor (voice of the user) — prioritized
- **IA:** sidebar item **"Site Audit"** (lucide `ShieldCheck`), placed in the technical-health cluster right after **Index Status**, before Redirects. Routes: `/sites/:id/audit` (latest run = primary surface), `/sites/:id/audit/runs`, `/sites/:id/audit/runs/:runId`; finding detail as a right-hand **Sheet** (keeps triage flow; full routed page only for deep-linkable sharing).
- **P0: diff is the hero, severity is the organizer.** Page order: trust strip ("Last audit Mon 6:04am · 214 pages checked · 18 detectors ran, 1 skipped · next Sun 11pm") → **"What changed this week"** block (reuse `ChangeDigest` chips/highlight pattern: ▲ new / ● persisting / ✓ resolved) → clickable severity distribution bar → grouped findings table.
- **P0: grouped findings — one issue = one row** ("Duplicate titles — 6 pages"), expandable (model: `McpChangesPanel` collapsible `ProposalRow`); cap inline URL lists (~20 + "+N more" + export). The #1 alarm-fatigue defense.
- **P0: max 3 severity levels** (Critical / Warning / Notice → red / amber / sky), reusing existing chip styling; **AI hypothesis visually distinct from measured fact** (`Sparkles` + `#4e8af4` AI treatment; detector fact rendered as data).
- **P0: honest states** — first-run teaching card listing the detector catalog + [Run first audit now]; run-in-progress via the existing live-poll pattern with previous findings visible (never blank); **partial run shows per-detector status** ("CWV didn't complete — showing last week's"); zero findings must feel *earned* (list what was checked and passed); stale-run amber banner (>8 days = the Sunday run probably failed — silence is the worst outcome); muted hidden by default behind a `[☐ show muted]` toggle, excluded from all counts.
- **P0: deep-links carry return context** (`?from=audit&finding=…`, pre-filtered target); findings with no CMS fix hide the button rather than disable it.
- **The AI-task dialog is the trust centerpiece:** model on **`AiReviewDialog.tsx`** (evidence read-only on the left, editable AI-drafted title+description on the right), plus section/assignee/due pickers reused from `SiteTasksPage`'s create form; honest footer copy ("This creates a task in Asana ({project})"); after create → toast + **Open in Asana** + persistent linked-task chip on the finding. Keep the rule clean: MCP-initiated Asana writes go through `McpChangesPanel`; the audit's human-initiated → AI-drafts → human-approves flow is a dialog, not the pending queue. **AI never writes to Asana/WP without explicit confirm.**
- **P1:** bulk select (mute-selected / one-task-for-selected) reusing the Index Status selection bar; [Run now] with spinner+toast; "5 resolved this week, 23 open (down from 31)" reinforcement line; group-by toggle (severity | category); keyboard triage (j/k/m/f).
- **Cross-site MVP:** replace the `HomePage.tsx` stub (currently a light-theme Vite leftover) with a "This week's regressions" list — one row per site, new-critical badge + top new finding, worst first, all-clear sites collapsed. Nothing more in v1.

### Conflicts resolved
- *SEO advisor wants immediate paging for true disasters* vs *weekly cadence*: → P0 detectors are architecturally separable; **Phase 1 ships Monday-dashboard-only**, alert transport (email digest) is decision D8, and nothing prevents later promoting P0 checks to a nightly micro-run.
- *Data analyst wants nightly-fresh axes surfaced live* vs *UX wants one coherent weekly snapshot*: → **hybrid with explicit per-axis as-of labels** — axes owned by nightly modules (index state, redirect issues) display their own freshness clock; the audit's own detectors display the weekly run clock. Never blended into one implied freshness.
- *UX wants a "healthy score" moment* vs *analyst warns any score without denominators/discontinuity guards is indefensible*: → **no health score in v1** (counts + diff + coverage only); score deferred to decision D9.
- *SEO wants many checks* vs *alarm fatigue*: → severity tiers are also **behavior tiers** (P0 = delta-alert; P1 = sorted backlog; P2 = informational panel), not just colors.

---

## 4. Architecture

### 4.1 Backend module: `backend/src/audit/`

Mirrors verified conventions: controller under `sites/:siteId/audit` (global `/api` prefix + TransformInterceptor `{data}` wrapping), raw-SQL migrations with real `down()`, `@Cron` living inside the module's service (like `crawl-scan.service.ts` / `redirect-sync.service.ts` — ScheduleModule is global), pure versioned logic modules with spec files (like `crawl-normalize.ts`, `redirect-diff.ts`, `impact-metrics.ts`).

**Entities / tables (4):**

**`audit_runs`** (lineage — one row per site per run; clone the `crawl_scan_runs` discipline)

| column | notes |
|---|---|
| `id` uuid PK, `siteId` uuid indexed | |
| `trigger` | `weekly` \| `manual` |
| `status` | `running` \| `complete` \| `partial` \| `failed` |
| `startedAt`, `finishedAt` timestamptz | our clock; UI renders in America/New_York |
| `detectorVersions` jsonb | `{checkType: version}` snapshot for this run |
| `coverage` jsonb | per detector: `{subjectsSelected, subjectsEvaluated, subjectsErrored, subjectsTimedOut, scopeComplete}` |
| `scopeSignature` varchar | hash of selection rule + subject-set size — trend discontinuity guard |
| `liveFetchesUsed` int, `liveFetchBudget` int | bounded live-fetch honesty |
| `summary` jsonb | `{newCount, resolvedCount, persistingCount, unconfirmedCount, bySeverity}` |
| `errorBreakdown` jsonb | like `crawl_scan_runs` |

**`audit_findings`** (mutable current state — one row per stable finding; unique `(siteId, fingerprint)`; clone + harden the `redirect_issues` pattern)

| column | notes |
|---|---|
| `id` uuid PK, `siteId` uuid | |
| `fingerprint` char(64) | `sha256(checkType:subjectKey[:discriminator])` — identity is **subject + collision key, never the observed value** |
| `checkType` varchar | from the catalog (§2), e.g. `noindex_regression`, `duplicate_title`, `sitemap_broken` |
| `severity` varchar | `critical` \| `warning` \| `notice` — **deterministic**, from a versioned tier table (like `redirect-audit-rank.ts:SEVERITY`) |
| `status` varchar | `open` \| `resolved` \| `muted` \| `accepted` |
| `subjectKey` varchar(2048) | normalized URL, `site`, or collision hash |
| `title` text | deterministic human title ("noindex appeared on /pricing") |
| `evidence` jsonb | **verbatim** raw values via `evidenceFor()` envelopes: statuses, headers, canonical pair, GSC clicks-at-risk (window via `gsc-date.ts`), sample sizes |
| `affectedUrls` jsonb | mutable member list (for collision-group findings) + count |
| `firstSeenAt`, `lastObservedAt` timestamptz | condition confirmed present |
| `lastEvaluatedAt`, `lastEvaluatedRunId` | subject actually checked (even if still failing) — the anti-flapping field |
| `resolvedAt` timestamptz, `resolutionBasis` | `verified_absent` only; **never** "not seen this run" |
| `regressionCount` int | resolved→reappeared counter |
| `detectorVersion` int | bump-aware diffing |
| `aiAnalysis` jsonb nullable | `{explanation, rootCauseHypothesis, suggestedSeverity, model, generatedAt, evidenceRefs}` — hypothesis, stored separately from deterministic fields |
| `muteReason` text, `mutedAt`, `mutedBy` | mute persists by fingerprint across runs |
| `asanaTaskGid` varchar nullable | linked task (dedupe: one open task per finding) |
| `fixRoute` varchar nullable | computed CMS deep-link (route + query), null ⇒ task-only |

**`audit_observations`** (append-only ledger — one row per finding per run in which its detector evaluated the subject)
`id, siteId, runId, fingerprint, checkType, observedStatus (present|absent), rawSignal jsonb (verbatim detector input), detectorVersion, observedAt`. This is what makes severity + AI interpretation **re-derivable without re-crawling** after a detector bump, and it is the audit's equivalent of `crawl_inspections.rawPayload`.

**`audit_site_settings`** (per-site config + kill switch, like optimization/asana settings)
`siteId PK/unique, enabled boolean default true, liveFetchBudget int default 50, aiAnalysisEnabled boolean default true, muteDefaults jsonb, notifyEmail varchar nullable (D8)`.

**Pure logic modules (no I/O, versioned, spec-tested — the highest-value test files):**
- `audit-fingerprint.ts` — per-checkType identity rules (documented per detector; collision keys for duplicate-title/hreflang clusters; chain-head keys). Exports `FINGERPRINT_VERSION`.
- `audit-detectors/*.ts` — one pure function per check: `(subjects, signals) → RawFinding[]`; each exports its `version` and its deterministic severity; `AUDIT_DETECTOR_VERSIONS` aggregated.
- `audit-diff.ts` — pure `diff(prevFindings, currFindings, coverage) → {new, resolved, persisting, unconfirmed}`; **resolve gated on `scopeComplete && verified_absent`**; stable-sorted; unit-tested like `redirect-diff.spec.ts`.

**Services:**
- `audit-source.service.ts` — **readers, not fetchers**: pages table (meta/canonical/robots/H1/links/schemas/sitemap-membership), `crawl_page_status` (Google verdicts), `RedirectValidateService.getIssues()`, schema validation state, ALT coverage, CrUX field data, PageSpeed, GSC clicks/impressions via the impact cache (windows via `gsc-date.ts`, aggregation via `impact-metrics.ts:aggregate()`).
- `audit-fetch.service.ts` — the bounded live set: robots.txt (+ stored-copy diff), sitemap fetch/parse, homepage HTTP/HTTPS + cert, 404-probe, P0-suspect re-verification (cache-busted, model: `schema-qc.service.ts:fetchLive`). `axios` + `CMS-Bot/1.0` UA + throttle (pattern: `crawl-scan.service.ts`), hard per-run budget from settings.
- `audit-run.service.ts` — orchestration: select subjects → gather signals (sources first, fetches second) → run detectors → fingerprint → upsert findings + append observations → diff vs previous run → persist run summary. Holds the `@Cron`.
- `audit-ai.service.ts` — the grounded interpretation layer (see 4.3).
- `audit-task.service.ts` — AI task drafting + creation via `AsanaTaskService.createTask` (see 4.4).
- `audit.controller.ts`, DTOs, `audit.module.ts`.

### 4.2 Scheduling (the user's requirement, made precise)

- `@Cron('0 5 * * 1', { timeZone: 'America/New_York' })` in `audit-run.service.ts` — **Monday 05:00 America/New_York** ("night from Sunday to Monday"). This is the **first cron in the codebase to pin a timezone** (all existing crons run server-local); `@nestjs/schedule@4.1.2` supports `timeZone` (verified in `package.json`).
- Why 05:00 ET: the nightly chain (1:00 crawl rotation, 2:00 parse, 3:00 ALT, 4:00 optimize/pagespeed/redirect-sync, server-local time — UTC in Docker) has finished, so the audit reads **fresh `rawHtml` parsed hours earlier** and yesterday's crawl/redirect verdicts. Guard: if a site's parse is still `running`/errored, that run is marked `partial` with the affected detectors' `scopeComplete=false` — never silently reported as complete.
- Per-site sequential execution with the existing throttle discipline; per-site kill switch `audit_site_settings.enabled`.
- Manual **[Run now]** (D7): same pipeline, `trigger='manual'`, per-site cooldown, shares the live-fetch budget.

### 4.3 AI analysis pipeline (grounding discipline, non-negotiable)

Deterministic first, AI as interpreter — the codebase's established pattern:

1. **Detectors decide existence + base severity** from versioned tier tables. AI can never create or dismiss a finding.
2. After the run, `audit-ai.service` sends **only server-computed evidence** (the `evidence` jsonb — verbatim values, GSC numbers with their date windows, coverage) per finding batch to `AiService` (existing OpenAI wrapper; model from the `openai_model` setting; per-check prompts owned in the Prompt Library like other modules).
3. AI returns, per finding: **plain-language explanation**, **root-cause hypothesis** (labeled hypothesis), **suggestedSeverity** (allowed to differ from deterministic severity by at most one tier; stored separately, displayed as AI opinion), **fix-direction sketch** (CMS-editable vs dev work).
4. **Faithfulness check** (same discipline as the SEO agent's grounding): every numeric claim in the AI text must appear verbatim in the evidence envelope; violations are rejected/regenerated and the deterministic view is shown alone. Token usage flows to the existing `token-usage` accounting.
5. UI renders detector output as **fact** and AI output under the existing AI treatment (`Sparkles`, `#4e8af4`) as **hypothesis** — never blended.
6. AI analysis is per-site toggleable (`aiAnalysisEnabled`) and its absence degrades gracefully (findings are complete without it).

### 4.4 Asana proposal flow (human-initiated → AI-drafts → human-approves)

- On **[Create Asana task]**: `POST …/findings/:id/task-draft` → `audit-task.service` builds a grounded draft: **title** (problem + scope), **description** = affected URLs with verbatim evidence, why-it-matters with GSC clicks/impressions at risk (+ window), **acceptance criteria**, suggested fix steps (CMS vs dev), back-link to the CMS finding + live URLs, severity. Same faithfulness check as 4.3.
- Frontend opens an **`AiReviewDialog`-style modal**: left = read-only evidence; right = editable title + description; below = section/assignee/due pickers (reused from `SiteTasksPage`'s create form, mapped project via `asana-project.service`). Footer: "This creates a task in Asana ({project name})."
- On confirm: `POST …/findings/:id/create-task` → existing `AsanaTaskService.createTask(siteId, dto)` (origin `cms`), then link: `asanaTaskGid` on the finding + an `asana_task_pages`-style linkage (`linkedEntityType: 'audit_finding'`, mirroring the existing task↔page link entity). Toast + **Open in Asana** permalink; finding shows a persistent linked-task chip.
- **Dedupe:** one open task per fingerprint; the button becomes "View task" until the task completes or is unlinked.
- **MCP path (separate, later phase):** read tools `audit_list_findings`, `audit_get_finding`, `audit_summary`; any MCP-initiated task creation continues through the **existing gated `asana.create` mcp-change flow** — the audit adds no new write path around the approval gate. The human dialog path and the MCP pending-queue path stay visually and semantically distinct (the UX advisor's "one rule": AI never writes without explicit confirm).

### 4.5 CMS-fixable mapping (computed `fixRoute` per checkType)

| checkType | Fix in CMS | Deep link (pre-filtered, `?from=audit&finding=:id`) |
|---|---|---|
| noindex_regression, canonical_regression, duplicate/missing/truncated title/description, missing H1 | ✅ Meta editor | `/sites/:id/meta` → `MetaEditPage` for the page |
| redirect chain/loop/dupe, broken internal link (fix = add redirect) | ✅ Redirects | `/sites/:id/redirects` |
| structured-data error | ✅ Schemas | `/sites/:id/schemas` / `SchemaDetailPage` |
| ALT coverage | ✅ Image ALT | `/sites/:id/images` |
| index-state cross-refs | ✅ Index Status | `/sites/:id/index-status` (segment filter) |
| CWV poor field data | ➖ diagnose only | `/sites/:id/pagespeed` + task |
| robots.txt, sitemap generation, cert/HTTPS, hreflang, 404-template, mixed content | ❌ task-only | button hidden, Asana path primary |

### 4.6 API surface (routes under `/api/sites/:siteId/audit/...`)

- `GET  /audit/summary` → latest run + diff counts + coverage + trust-strip data.
- `GET  /audit/findings?severity=&checkType=&status=&diff=new|persisting|resolved|unconfirmed&showMuted=&search=&page=` → grouped rows.
- `GET  /audit/findings/:id` → finding + evidence + observations history + linked task.
- `POST /audit/findings/:id/mute` `{reason}` / `POST …/unmute` / `POST …/accept` `{reason}`.
- `POST /audit/findings/:id/task-draft` → AI draft (does NOT create). `POST …/create-task` `{name, notes, sectionGid?, assigneeGid?, dueOn?}` → creates + links.
- `GET  /audit/runs` / `GET /audit/runs/:runId` (findings as-of that run, read-only).
- `POST /audit/run` → manual run (cooldown-guarded).
- `GET  /audit/export?runId=&format=csv` → **provenance header first** (§3, data advisor P1).
- `GET/PATCH /audit/settings` → per-site enable/budgets/AI toggle.
- Cross-site: `GET /api/audit/overview` → per-site diff summaries for the HomePage dashboard (one query, not N).

### 4.7 Frontend surface

- Nav: **"Site Audit"** (`ShieldCheck`) after Index Status in `RootLayout.tsx`; routes in `App.tsx`.
- `pages/SiteAuditPage.tsx` — trust strip → **ChangeDigest-style "What changed this week"** → severity distribution bar (clickable → filter) → grouped findings table (collapsible rows à la `McpChangesPanel`, selection bar for bulk mute/task) → finding detail in a right-hand `Sheet`.
- `pages/AuditRunHistoryPage.tsx` — run list + historical run view.
- `components/audit/`: `AuditTrustStrip`, `AuditChangeDigest`, `SeverityBar`, `FindingRow`, `FindingSheet`, `EvidenceBlock` (fact vs AI-hypothesis zones), `CreateTaskDialog` (AiReviewDialog pattern), `MutedToggle`.
- `HomePage.tsx` replacement (Phase 4): "This week's regressions" ranked site list.
- All states per the UX advisory: first-run teaching card with the detector catalog; live-poll during runs (previous findings stay visible); per-detector partial banners; earned "All clear" (list what passed); stale-run banner; muted excluded from every count.

**List view sketch:**
```
Sites › Poirier › Site Audit                        [Run now] [Runs ›] [Export]
┌ TRUST STRIP ─────────────────────────────────────────────────────────────────┐
│ Last audit Mon 5:04am ET · 214 of 214 pages evaluated · 18 detectors ran,    │
│ 1 partial (CWV — showing last week's) · next run Sun 11pm→Mon ET             │
└──────────────────────────────────────────────────────────────────────────────┘
★ WHAT CHANGED THIS WEEK      ▲ 3 new   ● 12 persisting   ✓ 5 resolved
  ▲ [CRIT] noindex appeared on /pricing (had 412 clicks/28d)   [Fix in CMS] [Task]
  ▲ [WARN] redirect chains grew: 8 chains >2 hops              [Fix in CMS]
  ✓ [RES ] sitemap 404s fixed — verified absent this run
SEVERITY  ██ Critical 2 · ████ Warning 9 · ██████ Notice 14   (based on 214/214)
Filters: [search] [Severity ▾] [Category ▾] [Diff: All ▾] [☐ show muted]
▸ [CRIT] noindex regression — 1 page   NEW        we checked 5:04am  [Fix][Task]
▸ [WARN] Duplicate titles — 6 pages    PERSISTING first seen Jun 14  [Fix][Task]
▸ [WARN] CWV poor (field) — 3 pages    UNCONFIRMED (not re-checked)  [Diagnose]
▸ [NOTE] Orphan pages (advisory) — 4   PERSISTING · muted "template" (dimmed)
```

---

## 5. Phased, reversible implementation plan

Guiding principle (house style): each phase is a thin, independently shippable vertical slice; every migration has a real `down()`; rollback = revert migration + remove nav/routes; no phase breaks the QC-round behavioral contracts (targeted schema publish, sitemap tombstones, redirect projection-hash, plugin honesty).

### Phase 1 — Vertical slice: run engine + P0 regression detectors + honest diff UI (the money slice)
**Scope:** the 4 tables; fingerprint/detector/diff pure modules; `audit-source` + `audit-fetch` (robots.txt diff, sitemap fetch, homepage/HTTPS/cert, 404-probe, suspect re-verify); the 7 P0 detectors; Monday-05:00-ET cron + [Run now]; `SiteAuditPage` with trust strip, change digest, grouped table, mute/accept, deep links. **No AI, no Asana, no P1 detectors, no cross-site, no export.** Findings show deterministic titles + evidence only — already fully useful.
**Migration:** next id in sequence, 4 tables + indexes, `IF NOT EXISTS`, real `down()`.
**Tests (highest value):** `audit-fingerprint.spec.ts` (identity stability per checkType, collision keys), `audit-diff.spec.ts` (resolve gated on scopeComplete + verified_absent; unconfirmed bucket; flap guards), detector specs with fixture signals, `audit-fetch` error/timeout → coverage accounting.
**Rollback:** revert migration, remove nav item + routes. Zero impact on existing modules (all reads).

### Phase 2 — P1 hygiene detectors + prioritization + export
**Scope:** detectors #8–#19 (readers over redirect/schema/ALT/CrUX/PageSpeed + in-DB dedupe + link graph + sitemap hygiene + hreflang gate); GSC impact-weighting of the backlog (via `gsc-date.ts` + `aggregate()` — not UTC slicing); severity/category grouping toggle; CSV export **with provenance header**; run-history page.
**Rollback:** remove detectors/routes; no destructive schema change.

### Phase 3 — AI interpretation + Asana task loop (the "AI analysis" requirement lands here)
**Scope:** `audit-ai.service` (grounded explanations, root-cause hypotheses, suggestedSeverity, faithfulness check, token accounting, Prompt Library entries); `audit-task.service` + `CreateTaskDialog` (AiReviewDialog pattern, section/assignee/due, create via `AsanaTaskService`, finding↔task link + dedupe chip); bulk task creation for selected findings.
**Why third:** AI interpretation needs a proven, trusted deterministic substrate; the Asana module is already live so this phase is glue, not infrastructure.
**Rollback:** `aiAnalysisEnabled=false` per site; remove dialog; findings remain complete without AI.

### Phase 4 — Cross-site Monday dashboard + MCP read surface
**Scope:** replace the `HomePage.tsx` stub with the "This week's regressions" ranked list (`GET /api/audit/overview`, one aggregate query); MCP tools `audit_list_findings` / `audit_get_finding` / `audit_summary` (read-only; task creation stays behind the existing gated `asana.create` flow); optionally the D8 email digest if locked in.
**Rollback:** restore HomePage stub; unregister MCP tools.

### Phase 5 (optional, demand-driven) — P2 informational panel + trends
**Scope:** llms.txt/AI-crawler info panel (neutral copy), OG/consistency checks, open-findings sparkline with scope-discontinuity markers, time-to-resolve/recurrence stats, client-ready PDF.

**Build now vs defer:** build Phase 1 in full (it is the disaster-alarm and the honesty foundation), Phase 2 quickly after (the weekly-hygiene payoff). Phases 3–4 are high-value glue on existing infrastructure. Phase 5 only on real demand.

---

## 6. Decisions (ALL LOCKED 2026-07-02 — owner accepted every recommendation below verbatim; kept for rationale)

1. **Exact run time.** "Sunday night → Monday" is implemented as **Monday 05:00 America/New_York** so the audit reads the finished nightly parse/crawl chain (which runs 1:00–6:00 server-local/UTC). Alternative: Sunday 23:00 ET (before the chain, reads day-old data). → **Recommend 05:00 ET Monday.**
2. **Crawl scope per run.** Full inventory (the `pages` table) every run vs rotation. At ≤2,000 pages and a read-mostly design, full scope is cheap and makes `scopeComplete=true` normal — which is what makes auto-resolve legitimate weekly. → **Recommend full scope over the `pages` inventory + a live-fetch budget (default 50/site/run) for the fetch-based detectors.**
3. **Denominator/inventory source.** Same question as the crawl module's D1: the audit's universe = the CMS `pages` table (sitemap-fed). Pages outside it are invisible to the audit. → **Recommend: `pages` table, stated in the UI ("of pages the CMS manages") — consistent with the crawl module's locked decision.**
4. **Finding-identity rules** (the data advisor's #3): confirm per-detector keys — duplicate-title findings keyed on normalized-title collision hash; hreflang clusters on cluster key; chains on chain head; page-scoped checks on `checkType + normalized URL`. → **Recommend as stated; freeze in `audit-fingerprint.ts` v1 before the schema migration.**
5. **Mute semantics.** Mute (stop alerting, reason required) vs Accept-as-intended (reclassifies to Notice, kept visible). Persist by fingerprint across runs; auto-resurface if severity rises or the affected set grows materially (>50%). Mutes are CMS-local (not synced to Asana/claude-seo). → **Recommend as stated.**
6. **AI severity authority.** → **Recommend: deterministic severity is authoritative; AI's `suggestedSeverity` is stored separately, may differ by max one tier, rendered as hypothesis.** An analyst can always strip the AI layer and see the raw deterministic view.
7. **[Run now] allowed?** → **Recommend yes** — post-fix re-verification is the trust loop — with a per-site cooldown (1/hour) and the shared live-fetch budget.
8. **P0 alert transport.** Monday dashboard only, or also an email digest when new criticals appear (and possibly a nightly micro-run of just the P0 detectors later)? → **Recommend: dashboard-only in Phase 1; add an email digest in Phase 4 if Mondays prove too slow in practice.** (`notifyEmail` field reserved in settings.)
9. **Health score.** → **Recommend NO score in v1** — diff counts + severity distribution + coverage denominators. If a client-facing score is ever added, it inherits the analyst's guards (explicit denominator, scope-discontinuity markers) as P0.
10. **Weekly-vs-nightly freshness display.** For axes owned by nightly modules (index state, redirect issues), show their live nightly state with its own as-of clock inside the audit, or freeze a weekly snapshot? → **Recommend hybrid with explicit per-axis as-of labels** — richer and single-source; the run stores the observation snapshot for the diff regardless.
11. **hreflang gate.** Auto-detect (validate only if hreflang is present in the parsed HTML) vs a per-site "multilingual" setting. → **Recommend auto-detect**; zero config, zero manufactured findings on monolingual sites.
12. **CWV alert basis.** → **Recommend CrUX field data only** decides pass/fail (PSI lab is diagnosis), and only for URLs/origin with sufficient CrUX coverage — small sites often have origin-level data only; label the granularity.
13. **Task dedupe rule.** → **Recommend one open Asana task per fingerprint** ("View task" replaces "Create task"); re-creation allowed after the linked task completes or is unlinked.
14. **Cross-site dashboard on `/` (HomePage)** in scope? It replaces the current stub and touches the app's landing surface. → **Recommend yes, Phase 4, minimal ranked-regressions list only.**

---

## 7. Out of scope (explicit non-overlap contracts)

- **Cloaking / hack detection** (Googlebot-vs-user multi-axis fetch, deterministic divergence detectors, triage queue) — the planned Security module. The audit fetches only as `CMS-Bot`, never spoofs Googlebot, and makes no cloaking claims.
- **Index state per Google** — the Crawl & Index module (nightly, quota-bounded URL Inspection). The audit *consumes* `crawl_page_status` and deep-links; it never spends GSC inspection quota.
- **Redirect rule validation internals** — the Redirect module's engine. The audit surfaces `getIssues()` results and deep-links.
- **Schema generation/publishing, meta pushing, ALT generation, image optimization** — their modules. The audit reads their state and deep-links; it never writes to WordPress.
- **Rankings/keywords/impact analytics** (impact module), **content quality/E-E-A-T**, **backlinks**, **continuous uptime monitoring** (the audit's availability checks are weekly probes, not an uptime SLA).
- **Auto-fixing anything.** The audit is read-and-report; every write (Asana task, CMS fix) goes through a human.

---

## 8. Key reconnaissance facts this plan relies on (verified on `main`, 2026-07-02)

- **Asana module is merged and live** (PR #9): `asana-task.service.ts:createTask(siteId, {name, notes, assigneeGid, dueOn, sectionGid})` creates into the site's mapped project (origin `cms`); `asana_task_pages` linkage entity exists; MCP `asana_create_task` routes through the gated `asana.create` mcp-change. (MEMORY's "code not started" is stale.)
- **Redirect module is merged** (PR #13, Phases 1–5) — including `redirect-issue.entity.ts` (unique `(siteId, fingerprint)`, `severity`, `status`, `detectionVersion`, `firstSeenAt`/`resolvedAt`) and `redirect-audit-rank.ts` (`ISSUE_DETECTION_VERSION`, `SEVERITY` tier table) — the closest identity/severity template, **minus** its unsafe-for-us auto-resolve (see §3, data advisor P0) and its UTC date-slicing bug (`redirect-audit.service.ts:603`).
- **Crawl module** (PR #11): `crawl_scan_runs` lineage, `crawl_inspections` raw-payload ledger, `crawl-normalize.ts` versioned pure normalizer with `coverageWithDenominator` — the coverage/honesty template. Its nightly cron is `@Cron('0 1 * * *')` in `crawl-scan.service.ts`.
- **Nightly chain (server-local time, no timezones pinned anywhere yet):** 1:00 crawl rotation, 2:00 `parseAllSites`, 3:00 ALT autopilot, 4:00 optimize + pagespeed + redirect-sync, 5:00 watched-keywords, 6:00 optimization-effects. `@nestjs/schedule@^4.1.2` supports `@Cron(expr, { timeZone })`.
- **`pages` table already holds the detector inputs:** `rawHtml`, `metaTitle`, `metaDescription`, `h1Text`, `canonical`, `indexDirective`/`noindex`, `nofollow`, `detectedSchemas`, `contentStructure` (incl. links), `missingFromSitemapAt`, `isTransactional`, `lastScrapedAt`. The scraper fetches sitemaps recursively (`fetchSitemapUrls`) with an empty-fetch tombstone guard.
- **Grounding/evidence infrastructure exists:** `agent/evidence/evidence.ts` (`evidenceFor()`, verbatim-quote contract), `ai.service.ts` (OpenAI wrapper, `openai_model` setting), Prompt Library, `token-usage` accounting, `impact/gsc-date.ts` (GSC = America/Los_Angeles calendar, ~3-day lag) and `impact-metrics.ts` (`aggregate()`, `isSignificant()`).
- **Frontend precedents verified:** `SiteIndexStatusPage.tsx` (trust strip, distribution bar, live-poll, selection bar, honest states), `components/index-status/ChangeDigest.tsx` (the "what changed" hero), `McpChangesPanel.tsx` (collapsible review rows + honest confirm), `AiReviewDialog.tsx` (editable AI draft before commit), `SiteTasksPage.tsx` (create form + Open-in-Asana toast), `HomePage.tsx` (a Vite stub free to become the cross-site dashboard), sidebar in `RootLayout.tsx`.
- **QC-round contracts respected:** the audit adds no WordPress writes, no sitemap-tombstone changes, no redirect projection-hash interactions — read-only against all of them.

### Research sources (primary ones cited in §2)
Google Search Central: [robots.txt intro](https://developers.google.com/search/docs/crawling-indexing/robots/intro) · [block indexing (noindex)](https://developers.google.com/search/docs/crawling-indexing/block-indexing) · [robots meta specs](https://developers.google.com/search/docs/crawling-indexing/robots-meta-tag) · [consolidate duplicate URLs (canonical)](https://developers.google.com/search/docs/crawling-indexing/consolidate-duplicate-urls) · [crawl budget (large sites)](https://developers.google.com/search/docs/crawling-indexing/large-site-managing-crawl-budget) · [CWV & search results](https://developers.google.com/search/docs/appearance/core-web-vitals) · [site moves/redirects](https://developers.google.com/search/docs/crawling-indexing/site-move-with-url-changes). Industry: [SEJ — Google: llms.txt speculative](https://www.searchenginejournal.com/google-says-llms-txt-is-purely-speculative-for-now/577576/) · [SERoundtable — Google does not endorse llms.txt](https://www.seroundtable.com/google-does-not-endorse-llms-txt-40789.html) · [SEJ — hreflang mistakes](https://www.searchenginejournal.com/common-hreflang-tag-mistakes/455073/) · [SEJ — 404 vs soft 404](https://www.searchenginejournal.com/technical-seo/404-vs-soft-404-errors/) · [SEL — too many redirects](https://searchengineland.com/guide/too-many-redirects) · [Semrush — duplicate title tags](https://www.semrush.com/blog/duplicate-title-tags/) · [Semrush — site audit issues list](https://www.semrush.com/kb/542-site-audit-issues-list) (catalog cross-check).

**Recommendation:** approve **Phase 1** to build after locking decisions **D1–D5** (run time, scope, inventory, identity rules, mute semantics) — the rest can be locked before their phases.

---

## 9. Phase 1 build notes (2026-07-02, branch `feat/tech-audit-module`)

Implemented exactly per §5 Phase 1: migration `1799000000000-AddAuditModule.ts` (4 tables, IF NOT EXISTS, real `down()`); `backend/src/audit/` with pure spec-tested modules (`audit-fingerprint.ts` v1, `audit-head.ts` stored-rawHtml head parser, `audit-diff.ts` with resolve gated on `scopeComplete && verified_absent`, 7 P0 detectors under `audit-detectors/`), reader/fetch/run/status services, controller under `/api/sites/:siteId/audit`, `@Cron('0 5 * * 1', { timeZone: 'America/New_York' })` + Run-now (1h cooldown) + kill switch; frontend `SiteAuditPage` (trust strip, change digest, severity bar, grouped table, `FindingSheet` with evidence/observations/mute/accept, first-run/partial/stale/all-clear states), sidebar "Site Audit" (ShieldCheck) between Index Status and Redirects.

Two implementation details worth knowing (both honesty-driven, within plan intent):
- **Site-scope snapshots ride `audit_observations`** under a well-known `snapshotFingerprint(checkType)` — that's how the next run gets the previous robots.txt/sitemap/HTTPS copy for diffing, without a fifth table. An outage run (no robots body) never overwrites the baseline.
- **`pages.canonical`/`indexDirective` are CMS *intent*; observed state is parsed from stored `rawHtml`** (`audit-head.ts`). The intent-vs-observed divergence is precisely what the noindex/canonical detectors alert on; an intent match is silence.
