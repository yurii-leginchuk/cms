# Security / Cloaking-Detection — Backlog

Roadmap for the nightly cloaking & hacked-site detection module
(`backend/src/security/`, frontend Security page).

**Phase 1 — shipped** (PR #1, branch `feat/security-cloaking-phase1`): raw two-axis
fetch (Googlebot vs visitor), deterministic detectors (redirect-cloak, spam-lexicon,
injected-scripts, content-diff), versioned severity rubric, immutable findings ledger
+ deduped snapshots + mutable incidents with suppression, BullMQ queue + 04:00 cron,
triage queue UI with side-by-side diff and evidence export.

---

## Why a Phase 2 at all — Phase 1's blind spots

1. **No JavaScript is executed.** Phase 1 fetches raw HTML only. Modern cloaking /
   hacks usually run via JS (spam injected client-side, delayed `window.location`
   redirects, payloads that activate only after render). Raw HTML shows a clean page;
   the malicious part only appears once the code runs.
2. **Spoofed Googlebot from a datacenter IP is not the real Googlebot.** Advanced
   malware checks reverse-DNS and won't reveal itself to our pseudo-bot. So "clean"
   means "not proven dirty", not "safe".
3. **No allow-list for expected differences.** Legit A/B tests, personalization and
   varying banners create diffs we can't yet mark as expected → noise.

---

## Phase 2 — render eyes + trust layer

> Recommended order: ship the **headless core (2.1 + 2.2)** first — biggest detection
> gain and it makes the "don't break analytics" promise real for rendered scans.
> GSC oracle and allow-list are independent layers added next.

### 2.1 Headless render (Playwright) — core
- Run real Chromium that executes JS; capture the rendered DOM.
- Adds a render axis + **raw-vs-rendered diff** (catches JS-injected spam, delayed
  redirects, scripts that only paint in a browser).
- One browser per worker, a fresh context per axis (UA / Referer / cookies isolated).
- ⚠️ **Risk:** Chromium bloats the backend Docker image (~300 MB+), more CPU/RAM,
  slower per page. Add `playwright` + system Chromium to the backend Dockerfile;
  keep concurrency low. This is the riskiest piece — validate image size & memory.

### 2.2 Analytics blocklist — mandatory companion to headless
- Phase 1 ran no JS, so GA4 / Zaraz / GMB never fired. Once we render, those trackers
  WILL fire and pollute the client's analytics — so intercept and **`route.abort()`**
  them in headless:
  - GA4 / GTM: `*.google-analytics.com`, `*.googletagmanager.com`, path `**/collect`, `/g/collect`
  - Cloudflare Insights: `static.cloudflareinsights.com`
  - **Zaraz (first-party path!):** `**/cdn-cgi/zaraz/**` — block by path, not just 3rd-party host
  - GMB / Maps: `maps.googleapis.com`, `maps.gstatic.com`, `www.google.com/maps/`
- Honest blind-spot to document: server-side Zaraz in a Cloudflare Worker can't be
  aborted from the browser.

### 2.3 GSC URL Inspection API — honest oracle
- The only way to see what Google **actually** rendered/indexed. Use it (rate-limited,
  not every page) to **confirm** suspicions with real Google data instead of our
  pseudo-bot. Surface GSC Security Issues side-by-side.
- Requires expanding the existing GSC service-account OAuth scope (currently
  `webmasters.readonly`).

### 2.4 Per-site allow-list — anti false-positive
- "This external script / domain / difference is expected here — don't flag it."
- Single biggest long-term noise reducer; without it alarm fatigue kills adoption.

### 2.5 Sitemap-fresh-URL ingestion
- Phase 1 scans only pages already known to the CMS. Attacker-created pages aren't in
  that list. Pull the fresh sitemap (reuse `ScraperService.fetchSitemapUrls`) to scan
  newly added URLs. NOTE: findings/snapshots FK to `pageId`, so new URLs must first be
  materialized as `Page` rows (or relax the FK) — decide during planning.

### 2.6 Scan history + site-wide grouping in UI
- Heat-strip of the last ~30 nights ("started 3 nights ago"); group "one injected
  script across 400 pages" as a single incident in the UI (data model already keys
  incidents site-wide; this is the UI surface).

---

## Phase 3 — verification & delivery

- **Real-Googlebot verification:** reverse + forward DNS / Google IP-range check.
- **Site access-log ingestion via the WP plugin** → real reverse-DNS verification and
  IP-based cloaking detection.
- **Alert delivery beyond in-app:** email / Slack digest for critical incidents
  (Phase 1 decision was in-app only).
- **Recompute job on `rubricVersion` bump** (re-derive severities from stored signals).
- Deep links to GSC reindex / review after a site is cleaned.

---

## Phase 1 tails (small, not blockers)

- Snapshot **retention cleanup job** — `security_snapshot_retention_days` (default 90)
  is stored but not enforced yet.
- **Sidebar critical-incident count badge** on the Shield icon (deferred).
- Settings `security_scan_cron` / `security_concurrency` are reserved placeholders
  (cron is a static `@Cron` decorator; processor concurrency is fixed at 1).

---

## Locked decisions (carry into Phase 2 planning)

- Incident identity: a finding recurring after **resolve** opens a **NEW** incident
  (resolved is never auto-reopened); dismiss-as-false-positive **suppresses** the key.
- Site health: **ordinal** clean / warning / critical, **worst-dominant**.
- Severity rubric: deterministic + versioned; a single axis diff never escalates past
  info/low; ≥2 independent malicious signals → high/critical.
- Timestamps UTC; format on the frontend.
- `Site.openIncidentsCount` is computed on the fly (not denormalized).
