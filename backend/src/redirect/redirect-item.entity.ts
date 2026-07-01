import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Phase-1 drift state of a mirrored redirect.
 *  - `in_sync`        — the CMS projection matches what WP last returned.
 *  - `deleted_in_wp`  — was mirrored before, gone from WP now (tombstoned).
 * Later phases add `drifted_wp` / `pending_cms` once the CMS can hold a desired
 * state and push writes; the column exists now so migrations stay additive.
 */
export type RedirectDriftState = 'in_sync' | 'deleted_in_wp' | 'drifted_wp' | 'pending_cms';

/**
 * Mutable, one-row-per-redirect current-state projection for fast list reads. The
 * append-only history lives in `redirect_snapshots`; this table is the "latest
 * known state" fast path, upserted every sync.
 *
 * Identity is BOTH:
 *  - `pluginId` — Redirection's own row id (fast-path match across polls; unique
 *    per site), and
 *  - `fingerprint` — a content hash used to recognise a delete-then-recreate in
 *    WP as the same rule rather than churn a new/deleted pair.
 *
 * Two clocks, never merged:
 *  - `wpLastAccess`  — WP's clock (when the redirect last fired; may be stale/off).
 *  - `lastSyncedAt`  — OUR clock (freshness of this mirror row).
 * A tombstoned row keeps all its data and sets `deletedInWpAt` (never hard-deleted
 * in Phase 1 — the audit trail and hit lineage matter).
 */
@Entity('redirect_items')
@Index('UQ_redirect_items_plugin', ['siteId', 'pluginId'], { unique: true })
@Index('IDX_redirect_items_site_fp', ['siteId', 'fingerprint'])
@Index('IDX_redirect_items_site_drift', ['siteId', 'driftState'])
export class RedirectItem {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  /** Redirection's own row id (stable within a WP install, except recreate). */
  @Column({ type: 'int', nullable: true })
  pluginId: number | null;

  @Column({ type: 'char', length: 64 })
  fingerprint: string;

  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'text' })
  sourceNormalized: string;

  @Column({ type: 'text', nullable: true })
  target: string | null;

  @Column({ type: 'text', nullable: true })
  targetNormalized: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  matchType: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  actionType: string | null;

  @Column({ type: 'int', nullable: true })
  actionCode: number | null;

  @Column({ type: 'boolean', default: false })
  regex: boolean;

  @Column({ type: 'int', nullable: true })
  groupId: number | null;

  @Column({ type: 'text', nullable: true })
  groupName: string | null;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  /** WP clock — last time the redirect fired (null = never / logging off). */
  @Column({ type: 'timestamptz', nullable: true })
  wpLastAccess: Date | null;

  @Column({ type: 'int', default: 0 })
  wpLastCount: number;

  @Column({ type: 'varchar', length: 16, default: 'in_sync' })
  driftState: RedirectDriftState;

  /**
   * The pending CMS change awaiting approval for THIS redirect (Phase 2). Set when
   * a create/edit/delete/toggle is proposed; cleared on apply or reject. Drives the
   * `pending_cms` state and the three-way conflict check.
   */
  @Column({ type: 'uuid', nullable: true })
  pendingChangeId: string | null;

  /**
   * The remote fingerprint captured WHEN the pending CMS change was proposed. The
   * nightly sync compares WP's current fingerprint against this baseline: if WP
   * changed under us while a CMS change is pending, it's a conflict (`drifted_wp`)
   * — surfaced for the user to adjudicate, never silently overwritten.
   */
  @Column({ type: 'char', length: 64, nullable: true })
  pendingBaselineFingerprint: string | null;

  /** Set when the redirect vanished from WP — tombstone, never hard-deleted. */
  @Column({ type: 'timestamptz', nullable: true })
  deletedInWpAt: Date | null;

  /** Our clock — when WE last confirmed this from WP (freshness). */
  @Column({ type: 'timestamptz', nullable: true })
  lastSyncedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  firstSeenAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  lastRunId: string | null;

  /** Latest raw plugin row, verbatim — so a mapping fix can re-derive without a re-poll. */
  @Column({ type: 'jsonb', nullable: true })
  rawPayload: unknown;

  // ── Live-resolve cache (Phase 3) — last real HTTP trail for this redirect ────
  /** Final HTTP status of the live redirect chain (e.g. 200 / 404 / 0 = unreachable). */
  @Column({ type: 'int', nullable: true })
  liveFinalStatus: number | null;

  @Column({ type: 'text', nullable: true })
  liveFinalUrl: string | null;

  /** Number of hops in the live chain (0 = the source responded directly). */
  @Column({ type: 'int', nullable: true })
  liveHops: number | null;

  /** The observed hop trail [{ hop, url, status }] from the last live check. */
  @Column({ type: 'jsonb', nullable: true })
  liveTrail: unknown;

  @Column({ type: 'timestamptz', nullable: true })
  liveCheckedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  mappingVersion: number;

  @Column({ type: 'int', default: 0 })
  detectionVersion: number;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
