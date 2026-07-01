# Optimization Impact — Change-Events & Annotations Enhancement (PLAN)

Status: **PLAN ONLY — no product code, no migrations run.** Branch context: `main`.
Author: chief-architect synthesis, folding in three advisory boards (SEO specialist,
data analyst, UX designer) + web research.
Date: 2026-07-01.

> This plan **extends** the existing Optimization Impact module. It does not replace the
> assemble-on-read change-event stream, the manual `impact_annotations` entity, the
> `optimization_effects` measurement engine, or the GSC series/metrics discipline. Every
> new capability is grafted onto those primitives.

---

## 1. Goal & scope

### Goal
Turn the Impact timeline's change markers into a full, honest **change-annotation system**
so an SEO analyst can visually correlate the agency's optimization work with Search Console
performance — at two levels (site-wide and per-page), across all work categories, grouped
into readable batches, with a full drill-down per batch, plus Asana task completion and
better manual annotations.

### In scope
1. **Schema publishes** as markers (already partly sourced from `schema_history`) — confirmed present; formalize.
2. **Two levels of markers**: GLOBAL (site-wide graph, cross-page grouped) and PER-PAGE.
3. **Titles, Descriptions, ALT** as first-class categories (ALT is a **new** source).
4. **Category toggles** on the graph: schema / meta-title / meta-description / technical / alt / tasks / manual.
5. **Cross-category grouping** within a short, named window → one marker (with a researched window value).
6. **Grouped-marker detail dialog**: full breakdown by category, by page, before→after, links, effect drill-down.
7. **Manual annotations kept**, entry UX substantially upgraded.
8. **Asana task completion** → marker with info + link to the task.
9. **Task scope** (`sitewide` OR a chosen set of pages), settable in CMS UI, via MCP, and manually, at any time; projects onto the global graph and each scoped page.
10. **Marker/cluster CSV export** for reproducibility.

### Out of scope (this plan)
- Rebuilding the GSC series, brand split, keyword monitoring, or cannibalization panels (reused as-is).
- A statistical causal-inference engine (SearchPilot/GrowthBook-style Bayesian uplift). We stay **descriptive**: markers show *when* you changed something, never *that* it caused a move. Causal modelling is noted as a possible future, not built here.
- New GSC dimension plumbing (Search Appearance, Image search type) — recommended as a **P1 follow-on** to make schema/alt genuinely measurable (see §12, decision 8), not a Phase-1 dependency.
- Effective-dated (historically reproducible) task scope — documented limitation, P2 (see §7).

### How it extends, not replaces
- `ChangeEvent` (`backend/src/impact/change-event.ts`) gains a `category`, a `clusterId`, and task/scope-aware fields; the existing `type` stays for back-compat.
- `ChangeEventsService.listEvents` (`backend/src/impact/change-events.service.ts`) gains two new source blocks (ALT, tasks) and a deterministic time-based clustering pass; the existing meta/technical/schema/effect blocks are untouched in spirit.
- `impact_annotations` (`backend/src/impact/impact-annotation.entity.ts`) keeps its `pageId null = sitewide` duality; it gains optional `type`/`link` columns for categorized manual pins.
- The frontend `ImpactPage.tsx` + `ImpactTimeline.tsx` marker lanes are reshaped (unified lane + composition glyph), not rewritten.

---

## 2. Research findings (cited)

### 2a. Two DIFFERENT time concepts — do not conflate them
This is the single most important finding, independently flagged as **P0 by all three advisors**.

| Concept | What it answers | Order of magnitude | Where it lives in the code |
|---|---|---|---|
| **Grouping / deploy window** | "Were these changes *shipped together* as one batch of work?" | **~1–2 days** | NEW `GROUP_WINDOW_DAYS` |
| **Measurement lag** | "When can I *trust a before→after read* of the effect?" | **onset 14d, window 28d, measure-after ~42d** | existing `ONSET_GAP_DAYS=14`, `WINDOW_DAYS=28`, `CONFOUND_WINDOW_DAYS=28`, effects `MEASURE_AFTER_DAYS=42` |

**Google recrawl/reindex/re-rank latency is an argument for the SECOND, not the first.**
Google's own guidance is explicit that crawling, indexing and ranking are *separate processes on
separate schedules*, and that recrawl "can take anywhere from a few days to a few weeks" with **no
guarantee** of timing — high-value/high-change URLs are refreshed in hours-to-days, long-tail pages
in weeks ([Google Search Central — Ask Google to recrawl](https://developers.google.com/search/docs/crawling-indexing/ask-google-to-recrawl)).
Because that latency is variable by URL, you *cannot* pick a single latency number to widen a cluster;
widening the grouping window "to cover recrawl latency" would silently merge unrelated deploys and
**manufacture false batches** — teaching analysts to over-claim causation at exactly the marker.

So: the marker sits at the deploy day; the "too-early-to-read" band extends **14 days to its right**;
the earliest trustworthy read is around **day 42**. Latency explains why the *effect appears far to the
right of the marker* — it is not a reason to cluster more aggressively.

### 2b. Recommended grouping window
**`GROUP_WINDOW_DAYS = 2` (48h), inclusive, anchor-fixed greedy sweep, configurable per site.**
Rationale (data-analyst + SEO consensus): the grouping window's job is to collapse changes that share a
**human cause** — one work session / one deploy batch pushed across a working day or two — into one marker.
Two days also loosely coincides with active-page recrawl cadence, but we **do not oversell** that: a cluster
asserts shared *authoring*, not shared *effect*. Keeping it an order of magnitude below the 14/28/42-day
measurement constants guarantees it can never be mistaken for or bleed into effect measurement.
(Owner's "1–2 days" guess is correct; we lock 2 days as the default and make it a single named,
config-overridable constant so it is one-line auditable and reproducible.)

### 2c. Annotation-UX best practices (analytics & rank trackers)
- **Annotate every ship / campaign / anomaly**; markers appear on any report covering that date
  ([MarTech — GA4 annotations](https://martech.org/how-to-use-ga4-annotations-to-add-context-and-clarity-to-your-analytics/)).
- **Category + color taxonomy** kept consistent across the tool (SEO / website / tech / config / product / A-B / external event), documented so all stakeholders read markers the same way (MarTech, above).
- **Attach the change to the same date as the reading**, and combine rank movement with the site-change context that plausibly explains it — but keep them as *linked context*, not a claimed cause ([Semrush — GA for SEO](https://www.semrush.com/blog/google-analytics-seo/); [Ahrefs — GA for SEO](https://ahrefs.com/blog/google-analytics-for-seo/)).
- **Serious causal reads need a control**, not an annotation: SearchPilot/GrowthBook forecast a control group and adjust the variant to strip out seasonality, competitor moves and algorithm updates — i.e. an annotation next to a rising curve is *not* evidence of causation ([SearchPilot — for data analysts](https://www.searchpilot.com/data-analysts); [GrowthBook — A/B testing](https://www.growthbook.io/blog/what-is-a-b-testing)). Our UI must actively restrain over-claiming; we borrow their *framing discipline*, not their statistics.

**Takeaway folded into the design:** a named category taxonomy with consistent colors across lane/toggle/dialog;
markers dated to the deploy day; a first-class "changed together — can't be separated" callout in every grouped
dialog; and an explicit "earliest trustworthy read ≈ day 42" affordance.

---

## 3. Event model

### 3a. What is already sourced vs new
Verified in `backend/src/impact/change-events.service.ts`:
- **meta-title / meta-description** — sourced from `meta_history` (fields `title`/`description`), collapsed per page/save via `metaGroupKey`. ✅ already present.
- **technical** — `meta_history` fields `canonical/noindex/nofollow/ogTitle/ogDescription/ogImage`. ✅ present.
- **schema** — `schema_history` snapshots (`measurable:false`). ✅ present.
- **optimization_effect** — measured before→after cards, linked to meta markers. ✅ present.
- **ALT** — ❌ **new source**. `site_images.lastPublishedAt` exists but is **overwritten on each republish and has no history**; image→page is via `image_placements`, which is *reconciled* (rows can vanish).
- **tasks** — ❌ **new source**. `AsanaTask` has **no `completedAt`** and **no scope**.

### 3b. Assembled-on-read vs persisted — recommendation
**Keep clustering and the meta/technical/schema/effect stream assembled-on-read** (a pure function of
append-only tables — reproducible, no store to invalidate). **But persist the two lossy/mutable atomic
events**, because reading them from live mutable rows would make historical markers silently move or vanish:

1. **`alt_publish_event`** (NEW, append-only) — written at alt-push time, capturing the immutable
   `publishedAt`, the `altAfter`, and **the placement page-set as it was then** (do NOT recompute pages
   from live `image_placements` at read time — the data-analyst's P0). Shape:
   `id, siteId, imageId, canonicalUrl, publishedAt, altAfter, pageIds jsonb (page-set at publish), createdAt`.
   Rationale: republishing an image must not relocate or erase its earlier marker.
2. **`AsanaTask.completedAt`** (NEW column) + request Asana's `completed_at` opt-field in
   `asana-helpers.ts` `AsanaTaskRaw`/`mapTaskToMirror`. The marker date MUST be Asana's completion instant
   (their clock), never `lastSyncedAt`/`asanaModifiedAt`. For re-open/re-complete history, optionally add an
   append-only `asana_task_completion_event` (see §12 decision 4).

Everything else stays derived. `ChangeEvent` remains the single shared shape so the detail dialog's
before→after and `EffectQueriesSection` reuse work for every category.

### 3c. `ChangeEvent` shape changes (`backend/src/impact/change-event.ts`)
Add a **category** dimension (finer than `type`) and cluster/scope awareness. Keep `type` for back-compat.

```ts
export type ChangeEventCategory =
  | 'meta-title' | 'meta-description' | 'technical'
  | 'schema' | 'alt' | 'task' | 'manual';

// existing ChangeEventType stays: 'meta' | 'technical' | 'schema' (+ add 'alt' | 'task' | 'manual')
export interface ChangeEvent {
  // ...all existing fields...
  category: ChangeEventCategory;   // NEW — drives toggles + color
  clusterId: string;               // NEW — backend-computed, time-based (see §4)
  scope?: 'sitewide' | 'pages';    // NEW — tasks only
  taskUrl?: string | null;         // NEW — tasks: permalink to Asana
  measurable: boolean;             // alt + schema + task => false
}
```

Category mapping: `meta` splits into `meta-title` / `meta-description` (owner asked for both as separate
toggles); `technical` stays; `schema` stays; `alt`/`task`/`manual` are new. Manual annotations are folded
into the same feed as `category:'manual'` events so toggles, clustering and the dialog treat them uniformly.

---

## 4. Grouping / clustering design

### 4a. The rule (deterministic, testable) — anchor-fixed greedy sweep
1. Assemble all events (all sources, incl. manual).
2. **Total-order sort** by `(day, ts, id)` — `id` is the final tiebreak. (Fixes the current
   `change-events.service.ts:177` `return 0` on equal `ts`, which makes greedy grouping non-deterministic.)
3. Sweep: take the earliest ungrouped event as the **anchor**; include every later event `e` with
   `0 <= diffDays(anchor.day, e.day) <= GROUP_WINDOW_DAYS`. Close the cluster; repeat.
   **Anchor-fixed, not neighbor-chained** — chaining a run of 1-day gaps could transitively merge a whole
   month. Anchor-fixed clusters are bounded by the window and stable.
4. **Two levels = two partitions**, each swept independently:
   - **Global**: partition by `siteId`; sweep across **all pages and all categories** → satisfies both
     "10 schema pushes across pages → one marker" and cross-category "schema+meta+alt → one marker".
   - **Per-page**: partition by `pageId`; sweep within the page. `pageId=null` events (sitewide tasks,
     sitewide annotations) appear **only** in the global partition.
5. **Cluster identity** = a pure hash of `(level, partitionKey, anchorDay, GROUP_WINDOW_DAYS, sorted member event-ids)`.
   Same inputs → same `clusterId` → stable selection/URL. If a member mutates (scope edit, republish), the id
   legitimately changes — documented, not a bug.
6. Each cluster carries its **full member list** (event id + source table + source row id) so the dialog and
   CSV never re-derive membership.

### 4b. Category toggles interact with clustering
Toggling a category **re-runs the sweep over the enabled set** (backend-driven or recomputed client-side from
the full member list). This is why the SEO advisor insists clustering is **time-based on the backend**, not
pixel-based: the dot count, the CSV row count and the dialog must always agree regardless of zoom/range.
The existing pixel de-dupe in `ImpactTimeline.tsx:97` stays only as an *intra-lane visual* nicety on top of the
authoritative time clusters — never as the source of truth.

### 4c. Edge cases
- **GSC-tz day boundary**: all new dates bucket through `toGscDay` (America/Los_Angeles) — same as every
  existing marker. Anchor day is fixed, so a near-midnight event lands deterministically.
- **Day-precision events** (task `due`/date-only): honor `precision`; bucket at day granularity. Because
  `GROUP_WINDOW_DAYS >= 2 > 0`, a ±1-day placement ambiguity cannot split a same-batch group. Never render a
  day-precision event with a timestamp tooltip.
- **Low-sample effect** inside a cluster: show the existing "low sample — not significant"
  (`MIN_SIGNIFICANT_IMPRESSIONS`) state; never fabricate a delta.
- **Alt image on many pages**: one image republish touching 30 pages = **1 global event** (with a page-count)
  and **a per-page marker on each of the 30 pages** (see §12 decision 7).

### 4d. Confounders must include the new sources (SEO P0)
`markConfounders` (`change-events.service.ts:185`) currently only sees meta/technical/schema keyed by `pageId`.
Once ALT, schema-per-page and tasks are markers, each is a confounder for the others on the same page within
`CONFOUND_WINDOW_DAYS`. **A sitewide task must count as a confounder on every page's window.** Update
`markConfounders` accordingly — otherwise the "N other changes on this page" badge becomes actively false.
Keep `markConfounders` (28d, per-page) **independent** of the 2-day clustering.

---

## 5. Category toggles — API + UI

### API
- `GET /sites/:id/impact/events` returns each event with `category` + `clusterId` (+ manual events merged in).
  No new endpoint needed; the feed is filtered client-side by enabled categories (small N).
- Optional: accept `?categories=schema,alt` to let the backend pre-filter and pre-cluster for large sites
  (perf hedge; see §12 decision 6).

### UI (`ImpactPage.tsx`)
- Extend the existing category-toggle buttons (currently `meta/technical/schema` at `ImpactPage.tsx:246`) to the
  **7 categories**. Keep them as **legend-toggles** (color dot + label = both legend and control; multi-select).
  Prefer this over a shadcn segmented control (segmented implies single-select; 6–7 items overflow a bar).
- **Default ON**: meta-title, meta-description, technical, tasks, manual. **schema & alt default ON but rendered
  muted/hollow** (reuse the existing hollow/dashed non-measurable glyph at `ImpactTimeline.tsx:131-134`) — present
  for context, visually restrained so they don't imply causation in the clicks curve.
- **Persist** the toggle set per site in `localStorage` (analysts set their signal once).
- **Power-user**: shift-click a toggle to solo it (P2). `aria-pressed` on each button.

---

## 6. Grouped-marker detail dialog

Render as a **Sheet** (`frontend/src/components/ui/sheet.tsx`), not the inline `MarkerDetail` card and not the
small default `Dialog` — a Sheet handles long "N changes across M pages" lists, keeps the timeline visible for
context, and keeps the selected day-line lit. IA, top to bottom:

1. **Header**: the window date range ("Jun 12–13, 2026"), total counts, and a category-mix legend
   ("4 titles · 10 schema · 22 ALT · 1 task").
2. **Correlation callout, first-class**: when a cluster spans >1 category or >1 change, a bold line —
   "These changed together in this window; you can't separate their individual effects." This is the honest,
   elevated version of the existing `confoundedWith` warning (grouping *creates* confounding by definition).
3. **Confounder verdict up front**: "This batch touched 12 pages; 3 of them had other changes in the 28-day
   window." Analysts triage on this before anything else.
4. **Grouped by category, then by page.** Each row: subtype, page link (`?pageId=`), before→after where
   available. **Reuse `DeltaMetric`/`QCell`/`EffectQueriesSection` from `EffectCard.tsx` verbatim** so a measured
   meta change drills into per-query exactly as today.
5. **Per-row links**: open page view, Meta Manager (`/sites/:id/meta`), effect drill-down, and for tasks an
   external Asana link (`ExternalLink`, `target="_blank" rel="noopener noreferrer"`).
6. **"Earliest trustworthy read" affordance**: marker day + 42, with a per-row "not yet measurable / measurable
   now" state pulled from `effectStatus`.
7. **No batch totals.** Never a rolled-up "this batch earned +X clicks" headline — the single most tempting lie.
   Show per-page, impression-weighted, confounder-flagged rows only. Any number comes from `impact-metrics.ts`.
8. **Bulk actions** (P1): multi-select rows → export CSV / open all affected pages / add a manual annotation for
   external context. Virtualize/paginate for very large clusters; cap the glyph count at "20+".

---

## 7. Asana task → impact

### 7a. Completion event source
- Add `AsanaTask.completedAt: Date | null`; request Asana's `completed_at` opt-field in `AsanaTaskRaw` and map
  it in `mapTaskToMirror` (`asana-helpers.ts`). Populated by both "Sync now" (`asana-sync.service.ts`) and the
  webhook path (`asana-webhook.service.ts` → `refreshTask`).
- The task marker's **day = `toGscDay(completedAt)`** (immutable), never sync/modified time.
- **"Task completed" ≠ "change is live."** The marker copy must say it plots *task closure*. Where a task is
  linked to a real CMS change (`linkedEntityType`/`linkedEntityId` already exist), the dialog also shows/points
  to the actual deploy timestamp so a "Done" column drag never masquerades as a verified live-site diff.
- `measurable: false` for task markers; render **hollow/distinct** so they read as a *workflow proxy signal*,
  not a verified diff (UX P1).

### 7b. Task scope model — recommendation
- **Normalized join, not jsonb array**: new `asana_task_page(taskId, pageId, siteId)` + a `scope` enum on
  `AsanaTask` (`'sitewide' | 'pages'`). "Which tasks affect page X?" becomes an indexed join; a jsonb `pageIds`
  array can't index/join cleanly and rots. UI, MCP and manual edits all write the same join.
- **`sitewide` → global timeline only** (behaves like a site annotation), **not** a literal marker on every
  page (projecting one task onto hundreds of page timelines is noise). **`pages` scope → each of those page
  timelines + the global cluster.**
- **Reproducibility stance**: marker **date = `completedAt` (immutable)**; scope membership = **current**
  (mutable), with exports stamped "scope as-of {exportTime}". This is honest and cheap. Full historically
  reproducible scope (effective-dated join with `validFrom/validTo`) is **P2 / probably overkill** — documented
  limitation (see §12 decision 3). A scope edit must **never** rewrite the marker's day.
- **Attribution honesty (SEO P0)**: because "settable at any time" is an attribution hazard, the **completed
  marker snapshots the page-set as it was at completion** in its member data used for the historical breakdown;
  live scope edits are forward-looking. (Implementation: on completion, capture the current `asana_task_page`
  set into the persisted completion event / the marker's member payload. If we adopt the append-only
  `asana_task_completion_event`, the snapshot lives there.) This resolves the SEO-vs-analyst tension: **date and
  historical page-set are frozen at completion; the editable scope governs future markers.**

### 7c. Setting scope — three paths
1. **CMS UI**: task-detail Sheet is the single editor (see §9); a read-only scope chip + "Edit scope" link
   appears wherever the task marker/dialog shows on the Impact page.
2. **MCP tool** (`mcp-server/src/tools/asana.ts` + backend): add `asana.set_scope { taskGid, scope, pageIds? }`.
   Scope is **CMS-local metadata** (it does not write to Asana), exactly like `linkEntity`
   (`asana-task.service.ts:257`, which is CMS-only and ungated). **Recommendation: ungated/direct**, consistent
   with `linkEntity` — the human-approval `mcp-changes` gate is for changes that mutate the live WordPress site
   or Asana, which this does not. (See §12 decision 5.)
3. **Manual**: same service method behind the UI/MCP, callable any time.

New service method `AsanaTaskService.setScope(siteId, taskGid, { scope, pageIds })` writing the enum + join;
mirrors the existing `linkEntity` pattern.

---

## 8. Manual annotations UX upgrade

Keep the `impact_annotations` entity and its `pageId null = sitewide` duality. Improve entry & modelling:

- **Click-to-add on the timeline**: click an empty spot on the marker strip → a popover anchored at that date
  with prefilled date, label, **category/type**, optional **link**, and scope (this page vs sitewide, respecting
  the current view). Replaces the tiny inline "Pin event" input (`AnnotationsBar`, `ImpactPage.tsx:424`).
- **Schema change**: add optional `type varchar` (e.g. `core-update | migration | redesign | tracking | pr |
  seasonality | external`) and `link varchar` columns to `impact_annotation.entity.ts`. Manual pins then join the
  unified feed as `category:'manual'` with a subtype. (If the owner wants to keep manual as a single flat
  category, these columns are optional — see §12 decision 7-adjacent.)
- **Presets**: a small preset picker for the recurring event types above; optionally a seeded "known Google
  updates" list so analysts don't hand-type "March 2026 core update," each preset carrying a Search Central link.
- **Edit + delete** on existing pins (today only delete via the `X`). Optimistic add with a `sonner` toast; on
  failure keep the user's typed text.

---

## 9. Frontend design

### 9a. Timeline marker rendering — unified lane + composition glyph (UX P0)
The current "one lane per type" model **breaks** at 6–7 categories with cross-category collapse (a marker
containing schema+meta+alt can't live in one type-lane; 6 lanes × 16px fights the 96px small-multiple panels).
**Replace the per-type lane stack with a single unified "Changes" lane** below the plot (this *is* the shared
bottom lane strip the `metric === 'all'` small-multiples stack already renders — just richer):
- Each marker is a **cluster glyph** whose fill encodes the **category mix** (multi-segment ring / stacked dot
  using `TYPE_META` colors), with a **count badge** ("N changes") and, in global scope, a faint "· M pages"
  sub-label. If >~3 categories are present, fall back to a neutral dot + count (legibility over completeness;
  mix shown on hover/in the dialog).
- Cross-category grouping now has a natural home: proximity clustering runs across all enabled categories.
- **Vertical alignment** with the small-multiples is trivial (single strip, shared x-scale via the existing
  recharts hooks). Keep the existing selected-day `ReferenceLine` firing for grouped markers and while the Sheet
  is open.
- **Hover = orientation** (a real `ui/tooltip.tsx` popover: "6 changes · 4 pages · 3 schema, 2 meta, 1 alt"),
  **click = commitment** (opens the Sheet) — matches the existing `<title>`-hover / `onSelect`-click split.
- **Task markers** render hollow/distinct (reuse the `fill:#1a1d27` hollow style) to signal "workflow proxy,
  not a verified diff." **Sitewide** tasks/annotations use the quieter `Pin`-style track already used for
  page-vs-sitewide annotations (`ImpactPage.tsx:444`).

Per-page view may keep lighter per-category sub-lanes (a single page rarely clutters), but unifying both views
is more consistent and less code — **recommended: unified lane everywhere, toggles for isolation.**

### 9b. Category toggle control — see §5. 9c. Grouped detail Sheet — see §6.

### 9d. Task-scope assignment UI (UX P0)
- **Radio first, list second** (kills the "empty list = sitewide?" ambiguity):
  `( ) Sitewide   (•) Specific pages` → when "Specific pages", a **searchable, virtualized page checklist**
  with **"select by URL prefix (`/blog/*`)"** bulk-select and a running "N selected" count; selected pages shown
  as removable chips.
- **Lives on the task detail** (single source of truth; also settable via MCP + manually); a **read-only scope
  chip** ("Sitewide" / "42 pages ▸") appears on the Impact marker/dialog with an "Edit scope" link opening the
  same Sheet. **One editor, not two.**
- On save: toast "Scope updated — timeline markers will reflect this," and be explicit that changing scope
  **moves markers** between global/page timelines (silent relocation is confusing).
- **Net-new primitive**: `ui/` has **no combobox/command/virtualized-list**. Add shadcn `command`/`combobox`
  (available via the project's shadcn registry) or build a searchable virtualized checklist in a Sheet. Flagged
  as net-new work.

### 9e. States (don't ship without them)
- **Loading**: reuse `Skeleton` for the strip; `Loader2` inline for dialog sections.
- **Empty (filtered)**: "No schema changes in this range — clear filters," never a silent blank strip.
- **Empty (Asana not connected / no tasks)**: a distinct "Connect Asana to see completed tasks" card mirroring
  the existing `notConnected` GSC card; never a dead toggle with no explanation.
- **Error/recovery**: reuse "Couldn't load … try again"; annotation add/delete failure → toast + keep typed text.
- **Partial** (mixed measurable/non-measurable cluster): show both; label non-measurable exactly as today
  ("can't measure this one directly") — their *timing* is the point.
- **Accessibility**: real focusable `<button>` markers, `aria-pressed` toggles, focus-trapped Sheet, keyboard
  `←/→` extended to step between clusters and `Enter` to open the dialog.

---

## 10. Data-discipline guardrails (explicit — must all be honored)
1. **Correlation ≠ causation.** Markers show *when* you changed something, never *that* it caused a move. The
   grouped dialog carries a first-class "changed together — can't be separated" callout.
2. **No batch totals.** Never sum a cluster into "+X clicks." Per-page, impression-weighted, confounder-flagged.
3. **Never sum anonymized/disclosed query clicks to a page total** — reuse `impact-query.service.ts`; don't re-aggregate.
4. **Impression-weighted average position**, never a mean of averages, never called "rank" anywhere in the new dialog.
5. **All day bucketing via `gsc-date.ts` `toGscDay`** (America/Los_Angeles) — including ALT `publishedAt` and task `completedAt`. No `toISOString().slice(0,10)`.
6. **All metric math via `impact-metrics.ts`**; low-sample shows the existing "not significant" state.
7. **Grouping window is a NEW, separate constant** (`GROUP_WINDOW_DAYS=2`) documented as display-clustering only, explicitly NOT the 14/28/28/42-day measurement constants. `markConfounders` stays 28d and independent.
8. **Dual-clock honesty.** ALT `publishedAt`/task `completedAt` (source clock) vs our sync/observed time — never merged; exports carry both.
9. **`measurable:false` for schema, alt, task** propagates into clusters: a non-measurable-only cluster shows no effect delta; a mixed cluster never attributes the measurable delta to the whole group.
10. **Deterministic, reproducible feed**: total-order sort `(day, ts, id)`; pure-hash `clusterId`; persisted immutable atomic events for lossy sources; CSV stamped with `GROUP_WINDOW_DAYS`, GSC timezone, and `gscMaxAvailable()`.
11. **Immutable marker date, current scope** — a scope edit never rewrites a completed marker's day or its frozen historical page-set.
12. **Confounder detector includes all new sources**, incl. sitewide tasks counting on every page.

---

## 11. Phased rollout & test strategy

Tests use Jest backend `*.spec.ts` (module already has `change-events.service.spec.ts`, `impact-metrics.spec.ts`,
`gsc-date.spec.ts`, `optimization-effects.service.spec.ts`).

### Phase 1 — Backend event-model foundation (no UI change; fully back-compatible)
- Add `GROUP_WINDOW_DAYS=2` to `impact.constants.ts`.
- Extend `ChangeEvent` with `category` + `clusterId`; map existing types → categories (`meta`→`meta-title`/`meta-description`).
- Deterministic total-order sort `(day, ts, id)`.
- Time-based **clustering** function (anchor-fixed sweep), global + per-page partitions, pure-hash `clusterId`.
- **ALT source**: `alt_publish_event` entity + write hook at alt-push (`image-sync.service.ts` apply path); ALT block in `listEvents` (`measurable:false`, page-set from the event, not live placements).
- Update `markConfounders` to include ALT (+ scaffolding for tasks/sitewide).
- **Tests**: clustering determinism (equal-ts stability, anchor-fixed vs chaining, window boundary inclusive), global-vs-page partition, `clusterId` stability under reorder, ALT event → correct page-set, confounder count with ALT, grouping window strictly separate from 14/28/42 constants. Both builds green.

### Phase 2 — Asana task → impact + task scope
> **Dependency (flag):** the Asana module lives on branch `feat/asana-integration` / PR #9 and is **NOT on
> `main`**. Phase 2 must land after that merges (or rebase onto it). Phases 1, 3, 4 do not depend on Asana.
- Add `AsanaTask.completedAt` + request/map Asana `completed_at`; populate via sync + webhook.
- Task events in `listEvents` (`category:'task'`, `measurable:false`, `taskUrl`, day=`toGscDay(completedAt)`).
- Scope model: `AsanaTask.scope` enum + `asana_task_page` join; `AsanaTaskService.setScope`; capture page-set snapshot at completion (+ optional `asana_task_completion_event`).
- Endpoints: `GET/PUT /sites/:id/asana/tasks/:gid/scope`; MCP tool `asana.set_scope` (ungated, like `linkEntity`).
- Confounder detector: sitewide task counts on every page.
- **Tests**: completion day from Asana clock not sync clock; re-open behavior (decision 4); sitewide→global-only; pages-scope→each page + global; scope edit doesn't move marker day; "which tasks affect page X" join; MCP set_scope path.

### Phase 3 — Frontend timeline (unified lane + toggles + grouped Sheet)
- Reshape `ImpactTimeline.tsx` `MarkerLanes` → single unified lane + composition glyph + count/page sub-label; keep pixel de-dupe as visual-only over time clusters.
- 7 category legend-toggles + `localStorage` persistence + default-on set (schema/alt muted).
- Grouped-marker **Sheet** with the §6 IA; reuse `EffectQueriesSection`/`DeltaMetric`/`QCell`; correlation + confounder callouts; day-42 affordance; hover tooltip preview.
- Task-scope read-only chip on markers.
- **Tests**: component/RTL where feasible; manual QA of alignment with small-multiples, empty/filtered/error/not-connected states, keyboard nav. Frontend build green.

### Phase 4 — Manual annotation UX upgrade
- Click-to-add-on-timeline popover; optional `type`/`link` columns on `impact_annotation.entity.ts`; presets + known-updates seed; edit + delete; scope this-page-vs-sitewide.
- Merge manual pins into the unified feed as `category:'manual'`.
- **Tests**: annotation create/edit/delete with type+link; sitewide vs page scoping in feed; feed merge/cluster with manual events.

### Phase 5 (optional, P1 follow-on) — make schema & alt genuinely measurable + honest reads
- Ingest GSC **Search Appearance** (rich-result types) for schema and **Image** search type for alt so their
  clusters get a real before→after instead of only "can't measure this." (New GSC plumbing — scope/verify first.)
- "Explain this move" affordance: for a selected date range, list markers inside `[move − 42, move − 14]` (the
  plausibly-causal band), operationalizing the lag honestly.
- Saved page segments reused by task-scope and per-page reading.
- Marker/cluster **CSV export** endpoint (one row per member with `clusterId`, both clocks, `scopeAsOf`,
  header-stamped with window/timezone/max-available).

---

## 12. Open decisions for the owner (each with a recommendation)

**RESOLVED with the owner (2026-07-01):** #1 `GROUP_WINDOW_DAYS = 2`; #2 hybrid (persist
`alt_publish_event` + `AsanaTask.completedAt`); #3 normalized `asana_task_page` join + `scope`
enum, snapshot at completion; #4 **re-opened task's marker DISAPPEARS** (append-only
`asana_task_completion_event`); #5 MCP scope tool **ungated/direct**; #6 **yes**, `alt_publish_event`
history table; #7 defaults as recommended (schema & alt ON but muted; 30-page republish = 1 global +
per-page; manual annotations get optional `type`/`link`); #8 **schema/alt measurability = Phase 5**
(now: `measurable:false` timing markers only). All items took the recommended option.

1. **Grouping window length.** → **Recommend `GROUP_WINDOW_DAYS = 2` (48h)**, anchor-fixed, per-site
   overridable. Explicitly separate from the 14/28/28/42-day measurement windows. (Owner's 1–2 day guess confirmed.)

2. **Assembled-on-read vs persisted markers.** → **Recommend hybrid**: keep clustering + meta/technical/schema/
   effect assembled-on-read (reproducible), but **persist the two lossy atomic events** — `alt_publish_event`
   and `AsanaTask.completedAt` — so historical markers never silently move or vanish.

3. **Task-scope schema & reproducibility.** → **Recommend normalized `asana_task_page` join + `scope` enum**,
   marker date frozen at `completedAt`, historical page-set snapshotted at completion, **current** scope for
   future markers, exports stamped "scope as-of." Effective-dated (fully historically reproducible) scope is
   **P2/overkill** — document the limitation.

4. **Task re-open behavior.** → **Recommend**: a re-opened task's marker **disappears** until re-completed;
   keep an append-only `asana_task_completion_event` so complete→reopen→complete keeps the latest completion
   date honestly. (Alternative: single mutable `completedAt` — simpler, less history. Owner's call.)

5. **Is the MCP scope tool gated?** → **Recommend ungated/direct.** Scope is CMS-local metadata (no WordPress/
   Asana write), exactly like the existing ungated `linkEntity`. The `mcp-changes` human-approval gate is for
   live-site/Asana mutations, which this is not.

6. **Does ALT need a history table?** → **Yes — recommend `alt_publish_event`.** `site_images.lastPublishedAt`
   is overwritten per republish and has no history; reading page-sets from reconciled `image_placements` at read
   time would misattribute historical markers. (This also answers the perf hedge: with a persisted event table,
   `?categories=` pre-filtering is straightforward if read-time clustering ever gets heavy.)

7. **Default category visibility + ALT multi-page counting + manual categorization.**
   → Default ON: meta-title, meta-description, technical, tasks, manual; **schema & alt ON but muted/hollow.**
   → An image republish touching 30 pages = **1 global event (page-count shown) + a per-page marker on each of
   the 30 pages.**
   → **Recommend** adding optional `type`/`link` columns to manual annotations (core-update/migration/etc. with
   a link) rather than a flat single "manual" category — richer, still cheap.

8. **Make schema/alt truly measurable now, or later?** → **Recommend later (Phase 5).** It needs new GSC
   Search Appearance / Image-search-type plumbing. For Phases 1–4, keep `measurable:false` with the honest
   "timing only" framing; upgrade to real before→after reads as a P1 follow-on.

---

### Appendix — key files (verified)
Backend: `backend/src/impact/change-event.ts`, `change-events.service.ts`, `impact.controller.ts`,
`impact.constants.ts`, `impact-annotation.entity.ts`, `impact-annotations.service.ts`, `impact-metrics.ts`,
`gsc-date.ts`, `impact-series.service.ts`, `impact-query.service.ts`;
`backend/src/optimization-effects/optimization-effect.entity.ts`, `optimization-effects.service.ts`;
`backend/src/schema/schema-history.entity.ts`; `backend/src/pages/meta-history.entity.ts`;
`backend/src/images/site-image.entity.ts`, `image-placement.entity.ts`, `image-sync.service.ts`;
`backend/src/asana/asana-task.entity.ts`, `asana-task.service.ts`, `asana-sync.service.ts`,
`asana-webhook.service.ts`, `asana-helpers.ts`; `backend/src/mcp-changes/mcp-change.service.ts`;
`mcp-server/src/tools/asana.ts`.
Frontend: `frontend/src/pages/ImpactPage.tsx`, `frontend/src/components/impact/ImpactTimeline.tsx`,
`EffectCard.tsx`, `ChangesTable.tsx`, `ImpactQueriesPanel.tsx`; `frontend/src/api/impact.ts`,
`frontend/src/hooks/useImpact.ts`; `frontend/src/components/ui/sheet.tsx`, `dialog.tsx`, `tooltip.tsx`.
</content>
</invoke>
