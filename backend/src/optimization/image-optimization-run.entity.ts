import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';
import { bigintTransformer } from './numeric.transformer';

/**
 * Append-only HISTORY of a bulk optimization run — the "flow" that complements
 * the per-image "stock" (`ImageOptimization`). One row per run.
 *
 * The byte sums here are scoped to THIS RUN ONLY and are labelled as such so
 * nobody mistakes them for site totals (analyst P0-2/P1-2). Site totals come
 * from current-state rows; this table answers "what did run #7 do?".
 *
 * `settingsSnapshot` stores the ACTUAL values used (not a foreign key that can
 * change) so a run is self-describing and reproducible after the fact.
 */
export enum OptimizationRunScope {
  ALL = 'all',
  NEW_ONLY = 'new_only',
  FORCE_ALL = 'force_all',
}

export enum OptimizationRunTrigger {
  MANUAL = 'manual',
  NIGHTLY = 'nightly',
}

export enum OptimizationRunStatus {
  RUNNING = 'running',
  DONE = 'done',
  CANCELLED = 'cancelled',
  ERROR = 'error',
}

@Entity('image_optimization_runs')
export class ImageOptimizationRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  siteId: string;

  @CreateDateColumn()
  startedAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  finishedAt: Date | null;

  @Column({
    type: 'enum',
    enum: OptimizationRunTrigger,
    default: OptimizationRunTrigger.MANUAL,
  })
  triggeredBy: OptimizationRunTrigger;

  @Column({ type: 'enum', enum: OptimizationRunScope })
  scope: OptimizationRunScope;

  /** The actual {quality, webpEnabled, maxWidth} used — self-describing. */
  @Column({ type: 'jsonb', default: () => "'{}'" })
  settingsSnapshot: Record<string, unknown>;

  @Column({ type: 'varchar', length: 64, nullable: true })
  settingsFingerprint: string | null;

  @Column({ type: 'int', default: 0 })
  imagesConsidered: number;

  @Column({ type: 'int', default: 0 })
  processed: number;

  @Column({ type: 'int', default: 0 })
  optimized: number;

  @Column({ type: 'int', default: 0 })
  skipped: number;

  @Column({ type: 'int', default: 0 })
  failed: number;

  // ── Byte rollups for THIS RUN ONLY (not site totals) ────────────────────────
  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  originalBytesSum: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  optimizedBytesSum: number;

  @Column({ type: 'bigint', default: 0, transformer: bigintTransformer })
  bytesSavedSum: number;

  @Column({
    type: 'enum',
    enum: OptimizationRunStatus,
    default: OptimizationRunStatus.RUNNING,
  })
  status: OptimizationRunStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;
}
