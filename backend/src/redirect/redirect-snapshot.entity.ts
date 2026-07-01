import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

/** What kind of change this snapshot records for its redirect. */
export type RedirectChangeKind = 'first_seen' | 'updated' | 'deleted';

/**
 * Append-only ledger — ONE row per observed CHANGE to a redirect (deduped by
 * `fingerprint` per plugin id, so a re-poll that changed nothing writes nothing).
 * Stores the FULL raw plugin row so a mapping bug can be re-normalized
 * retroactively without re-polling. This is the source of truth for the per-redirect
 * history timeline and (later phases) the "what changed in WP since you last looked"
 * drift feed.
 */
@Entity('redirect_snapshots')
@Index('IDX_redirect_snapshots_item', ['siteId', 'pluginId', 'observedAt'])
@Index('IDX_redirect_snapshots_run', ['runId'])
export class RedirectSnapshot {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid', nullable: true })
  runId: string | null;

  @Column({ type: 'int', nullable: true })
  pluginId: number | null;

  @Column({ type: 'char', length: 64 })
  fingerprint: string;

  /** The fingerprint BEFORE this change (null on first-seen) — powers from→to. */
  @Column({ type: 'char', length: 64, nullable: true })
  prevFingerprint: string | null;

  @Column({ type: 'varchar', length: 16 })
  changeKind: RedirectChangeKind;

  /** OUR clock — when this observation was recorded. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  observedAt: Date;

  // ── Denormalized snapshot of the redirect at this point (for the timeline) ──
  @Column({ type: 'text' })
  source: string;

  @Column({ type: 'text', nullable: true })
  target: string | null;

  @Column({ type: 'int', nullable: true })
  actionCode: number | null;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  /** Full raw plugin row, verbatim, for retroactive re-normalization. */
  @Column({ type: 'jsonb', nullable: true })
  rawPayload: unknown;

  @Column({ type: 'int', default: 0 })
  mappingVersion: number;

  @Column({ type: 'int', default: 0 })
  detectionVersion: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  apiVersion: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
