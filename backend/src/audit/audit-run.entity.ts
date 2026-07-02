import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

export type AuditRunTrigger = 'weekly' | 'manual';
export type AuditRunStatus = 'running' | 'complete' | 'partial' | 'failed';

/** Per-detector coverage ledger — the honesty substrate for auto-resolve. */
export interface DetectorCoverage {
  subjectsSelected: number;
  subjectsEvaluated: number;
  subjectsErrored: number;
  subjectsTimedOut: number;
  /** true ⇔ every selected subject was actually evaluated this run. */
  scopeComplete: boolean;
}

export interface AuditRunSummary {
  newCount: number;
  resolvedCount: number;
  persistingCount: number;
  unconfirmedCount: number;
  bySeverity: Record<string, number>;
  /** Inventory denominator honesty for the trust strip. */
  pagesTotal: number;
  pagesEvaluated: number;
}

/**
 * Lineage — one row per site per audit run (weekly cron or manual). Clones the
 * `crawl_scan_runs` discipline: versions + coverage + budget are recorded so
 * every finding is reproducible and the UI can be honest about partial scope.
 */
@Entity('audit_runs')
@Index('IDX_audit_runs_site', ['siteId', 'startedAt'])
export class AuditRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 16 })
  trigger: AuditRunTrigger;

  @Column({ type: 'varchar', length: 16, default: 'running' })
  status: AuditRunStatus;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** `{checkType: version}` snapshot for this run — bump-aware diffing. */
  @Column({ type: 'jsonb', nullable: true })
  detectorVersions: Record<string, number> | null;

  /** Per-detector coverage ledger (auto-resolve is gated on scopeComplete). */
  @Column({ type: 'jsonb', nullable: true })
  coverage: Record<string, DetectorCoverage> | null;

  /** Hash of selection rule + subject-set size — trend discontinuity guard. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  scopeSignature: string | null;

  @Column({ type: 'int', default: 0 })
  liveFetchesUsed: number;

  @Column({ type: 'int', default: 0 })
  liveFetchBudget: number;

  @Column({ type: 'jsonb', nullable: true })
  summary: AuditRunSummary | null;

  @Column({ type: 'jsonb', nullable: true })
  errorBreakdown: Record<string, number> | null;

  @Column({ type: 'text', nullable: true })
  fatalError: string | null;
}
