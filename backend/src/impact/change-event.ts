/**
 * A single tracked change to the live site, normalized from one of several sources
 * (meta edits, technical edits, schema pushes) into one shape the
 * impact timeline can plot. Kept as a plain interface (not an entity) — these are
 * assembled on read, never stored.
 */

export type ChangeEventType = 'meta' | 'technical' | 'schema' | 'alt' | 'task' | 'manual';

/**
 * Finer than `type` — drives the per-category legend toggles and marker color.
 * `meta` splits into title vs description (each an independent toggle).
 */
export type ChangeEventCategory =
  | 'meta-title'
  | 'meta-description'
  | 'technical'
  | 'schema'
  | 'alt'
  | 'task'
  | 'manual';

export type ChangeEffectStatus = 'pending' | 'measured' | 'no_data';

export interface ChangeEvent {
  /** Stable id: `${type}:${sourceId}` so the frontend can key/select markers. */
  id: string;
  type: ChangeEventType;
  /** Finer bucket for the per-category toggles (see ChangeEventCategory). */
  category: ChangeEventCategory;
  /**
   * Time-based cluster id (backend-computed). Events shipped within
   * GROUP_WINDOW_DAYS in the same partition (site-wide or a single page, per the
   * request scope) share a clusterId → one grouped marker. Pure hash of
   * (level, partitionKey, anchorDay, window, sorted member ids) — same inputs give
   * the same id; a member mutation legitimately changes it.
   */
  clusterId: string;
  /** e.g. 'title + description', 'canonical', 'noindex', 'schema'. */
  subtype: string;
  pageId: string | null;
  pageUrl: string;
  /** ISO timestamp of the change. */
  ts: string;
  /** GSC-timezone calendar day the marker sits on (YYYY-MM-DD). */
  day: string;
  /** 'day' when only a date is known, else 'timestamp'. */
  precision: 'day' | 'timestamp';
  summary: string;
  before: string | null;
  after: string | null;
  /**
   * Whether this change's effect is directly measurable in clicks/impressions.
   * Schema pushes mostly affect rich-result eligibility (searchAppearance), which
   * the basic searchAnalytics series can't isolate — so they're flagged false and
   * the UI labels them "impact not directly measurable here".
   */
  measurable: boolean;
  /** Linked optimization_effects status for meta changes, when present. */
  effectStatus: ChangeEffectStatus | null;
  /** Linked optimization_effect id (for the per-query drill-down), when present. */
  effectId: string | null;
  /** Other tracked changes on the same page within the measurement window. */
  confoundedWith: number;
  /** Task events only: 'sitewide' | 'pages' scope (Phase 2). */
  scope?: 'sitewide' | 'pages';
  /** Task events only: permalink to the Asana task (Phase 2). */
  taskUrl?: string | null;
}
