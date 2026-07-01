import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

export type RedirectAuditTrigger = 'first_sync' | 'manual' | 'resync';

/**
 * Lineage for a first-sync audit run: what the survey found, when, at which
 * detection version, and the ambient GSC/GA4 connection context that backed the
 * enrichment (so a low-evidence ranking is explainable after the fact).
 */
@Entity('redirect_audit_runs')
@Index('IDX_redirect_audit_runs_site', ['siteId', 'startedAt'])
export class RedirectAuditRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 16 })
  trigger: RedirectAuditTrigger;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'int', default: 0 })
  detectionVersion: number;

  @Column({ type: 'int', default: 0 })
  redirectsAnalyzed: number;

  @Column({ type: 'int', default: 0 })
  issuesOpen: number;

  @Column({ type: 'int', default: 0 })
  issuesResolved: number;

  /** Counts by issue type + by severity, for the summary strip. */
  @Column({ type: 'jsonb', nullable: true })
  byType: Record<string, number> | null;

  @Column({ type: 'jsonb', nullable: true })
  bySeverity: Record<string, number> | null;

  // ── Ambient enrichment context (why the ranking is trustworthy or not) ──────
  @Column({ type: 'boolean', default: false })
  gscConnected: boolean;

  @Column({ type: 'boolean', default: false })
  ga4Connected: boolean;

  /** Site-level GA4 organic revenue over the window (context, NOT per-issue). */
  @Column({ type: 'double precision', nullable: true })
  ga4OrganicRevenue: number | null;

  @Column({ type: 'text', nullable: true })
  fatalError: string | null;
}
