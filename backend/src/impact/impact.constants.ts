/**
 * Methodology constants for the Optimization Impact feature. Centralized so the
 * UI (lag shading, "too early" bands), the confounder detector, and any window
 * math all agree. Mirrors the spirit of optimization-effects.service.ts but adds
 * the onset gap the advisory board asked for.
 */

/** Comparison window length (days), matching optimization_effects. */
export const WINDOW_DAYS = 28;

/**
 * Days to skip after a change before the post-change window starts: Google needs
 * to re-crawl/re-index and the SERP needs to settle. An effect measured before
 * this has elapsed is not trustworthy.
 */
export const ONSET_GAP_DAYS = 14;

/** Two changes on the same page within this many days can't be isolated. */
export const CONFOUND_WINDOW_DAYS = 28;

/**
 * DISPLAY-clustering window (days). Changes shipped within this many days are one
 * batch of work → one grouped marker. This is a DEPLOY-CADENCE window ("were these
 * shipped together?") and is deliberately kept an order of magnitude away from the
 * measurement constants above (ONSET_GAP=14 / WINDOW=28 / CONFOUND=28) — grouping
 * is NOT measurement. Never widen it to "cover recrawl": that manufactures false
 * batches and invites over-claiming causation.
 */
export const GROUP_WINDOW_DAYS = 2;

/** Below this many impressions a window is "low sample — not significant". */
export const MIN_SIGNIFICANT_IMPRESSIONS = 100;
