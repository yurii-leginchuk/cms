# Redirect Module — TODO

WordPress redirect management (Redirection plugin sync + validation + audit + import/export).
Phases 1–5 built & verified (builds green, specs pass), **not yet committed, not yet live-verified**.

## Status
- [x] Phase 1 — read-only nightly sync + list
- [x] Phase 2 — write + drift + gated apply (via existing `mcp-changes` gate)
- [x] Phase 3 — validation engine (dupes/loops/chains) + live HTTP resolve
- [x] Phase 4 — first-sync audit queue + severity enrichment (GSC/GA4/index/inventory)
- [x] Phase 5 — bulk import/export (CSV/native-JSON/htaccess/nginx, dry-run, auto-backup)
- [ ] **Phase 6 — MCP tools + 404-log→redirect (NOT STARTED)**

---

## Phase 6 — scope (next up)
- [ ] **MCP tools** (`agent/tools/redirect-tools.ts`, factory like `schema-tools.ts`):
      READ tools execute directly; WRITE tools produce **gated proposal cards** (via Phase-2 `mcp-changes`), never direct WP writes.
- [ ] **Headline feature: `wp_redirection_404` log → redirect suggestion** —
      mine the plugin's 404 log (passive only; no active link-crawl per decision),
      rank by hits × GSC impressions, propose target via existing **`embedding/`** (semantic nearest live page, grounded w/ rationale + similarity score).
- [ ] **Quick "Add redirect"** one-click 301 from a 404 suggestion (prefilled, immediate WP push through gate, verify-after).
- [ ] **Guardrail** "you're redirecting a live money/indexed page" (surface loudly at create + in audit).
- [ ] **Bulk fixers** (proposals): 302→301 for long-stable temporaries; canonical-target normalization (http↔https, trailing-slash, www); domain-migration path-preserving find-and-replace (dry-run preview).
- [ ] **Activate the AI-judgment seam** from Phase 4 (`suggestJudgment` → schema-style grounded LLM instead of today's deterministic rationale).

## Before / around Phase 6 — live verification (do first on a throwaway subdomain)
- [ ] Install the **Redirection plugin** on the local test WP (localhost:8090) + real content redirects.
- [ ] Update the **poirier-cms connector to v1.9.0** on that WP (Phase-1/2 endpoints).
- [ ] End-to-end: nightly sync + "Sync now" pull real redirects.
- [ ] Verify a CMS create/edit/delete/toggle → gate approve → **immediate WP push → verify-after**.
- [ ] Verify drift (edit in WP admin) → banner + Keep-WP / Keep-CMS.
- [ ] Verify live-resolve trail + flatten proposal against real chains.
- [ ] Verify a real import (dry-run diff + auto-backup + gated apply) and export round-trip.

## Known follow-ups / deferrals (from phases 1–5)
- [ ] **Commit the work** — everything is uncommitted on `main`; branch + commit + PR when ready.
- [ ] Live-resolve **budget/cache is in-memory per-process** — needs a shared store for multi-instance deploy.
- [ ] **Import groups**: `group_id` is carried but the create path defaults to the first Redirection group — wire per-row group assignment.
- [ ] **Per-issue GA4 revenue**: currently site-level ambient only (`getSummary` has no page dimension) — per-URL attribution deferred.
- [ ] `redirect_to_404_410` / `redirect_to_noindex` issues only fire when the crawl/live cache is populated (honest under-report by design).
- [ ] Backup **retention/cleanup policy** (dry-run writes a backup each run).
- [ ] WP write field-mapping (`action_data`/`match_data`) assumes Redirection ≥5.x — confirm against the live install.

## Open design questions still unlocked (not blocking Phase 6)
- [ ] Undo semantics: real revert via plugin vs re-push previous value.
- [ ] `last_access` timezone + whether windowed hit-counters (hits/day) are needed vs cumulative `last_count`.

---
_Decisions locked (2026-07-01): nightly sync (not polling) + Sync-now; writes immediate on approval; drift = user-adjudicated default WP-wins; hybrid deterministic-engine + AI-for-judgments; per-site scope; 404 = passive log only (no active link-crawl)._
