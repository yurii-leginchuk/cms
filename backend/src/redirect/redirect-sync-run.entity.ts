import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

export type RedirectSyncTrigger = 'nightly' | 'on_demand';

/**
 * Lineage — one row per sync run (nightly rotation or an on-demand "Sync now").
 * Records the plugin state + versions + counts so every mirror is reproducible
 * and auditable, and so the UI can show honest "as of last night" freshness.
 * `redirectionActive` is a TERNARY: true / false (plugin absent) / null (we never
 * reached WordPress — no key or transport error).
 */
@Entity('redirect_sync_runs')
@Index('IDX_redirect_sync_runs_site', ['siteId', 'startedAt'])
export class RedirectSyncRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 16 })
  trigger: RedirectSyncTrigger;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  apiVersion: string | null;

  @Column({ type: 'int', default: 0 })
  mappingVersion: number;

  @Column({ type: 'int', default: 0 })
  detectionVersion: number;

  /** true / false(plugin not active) / null(WordPress unreachable / no key). */
  @Column({ type: 'boolean', nullable: true })
  redirectionActive: boolean | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  pluginVersion: string | null;

  /** Cheap "did anything change" gate — hash of the sorted per-item fingerprints. */
  @Column({ type: 'char', length: 64, nullable: true })
  wholeSetHash: string | null;

  /** true when the whole-set hash matched the last run and we short-circuited. */
  @Column({ type: 'boolean', default: false })
  unchanged: boolean;

  @Column({ type: 'int', default: 0 })
  redirectsFetched: number;

  @Column({ type: 'int', default: 0 })
  groupsFetched: number;

  @Column({ type: 'int', default: 0 })
  added: number;

  @Column({ type: 'int', default: 0 })
  updated: number;

  /** Tombstoned this run — present before, absent from WP now. */
  @Column({ type: 'int', default: 0 })
  deleted: number;

  @Column({ type: 'int', default: 0 })
  unchangedCount: number;

  @Column({ type: 'int', default: 0 })
  errored: number;

  /** Populated when the run couldn't reach WP / the plugin (scrubbed message). */
  @Column({ type: 'text', nullable: true })
  fatalError: string | null;
}
