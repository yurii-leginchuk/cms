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

/** Below this many impressions a window is "low sample — not significant". */
export const MIN_SIGNIFICANT_IMPRESSIONS = 100;
