import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

export type ObservedStatus = 'present' | 'absent';

/**
 * Append-only ledger — one row per (fingerprint, run) in which the detector
 * actually evaluated the subject. `rawSignal` stores the verbatim detector
 * input (statuses, headers, meta robots, canonical, robots.txt/sitemap slices)
 * so severity + later AI interpretation are re-derivable without re-crawling —
 * the audit's equivalent of `crawl_inspections.rawPayload`.
 *
 * Site-scoped detectors (robots.txt / sitemap / HTTPS) additionally append a
 * SNAPSHOT observation every run under a well-known fingerprint, which is how
 * the next run gets its "previous copy" for diff-based detection.
 */
@Entity('audit_observations')
@Index('IDX_audit_observations_fp', ['siteId', 'fingerprint', 'observedAt'])
@Index('IDX_audit_observations_run', ['runId'])
export class AuditObservation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid' })
  runId: string;

  @Column({ type: 'char', length: 64 })
  fingerprint: string;

  @Column({ type: 'varchar', length: 40 })
  checkType: string;

  @Column({ type: 'varchar', length: 12 })
  observedStatus: ObservedStatus;

  /** Verbatim detector input — append-only, never rewritten. */
  @Column({ type: 'jsonb', nullable: true })
  rawSignal: Record<string, unknown> | null;

  @Column({ type: 'int', default: 0 })
  detectorVersion: number;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  observedAt: Date;
}
