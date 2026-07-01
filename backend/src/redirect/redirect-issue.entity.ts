import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type RedirectIssueType =
  | 'loop'
  | 'possible_loop'
  | 'redirect_to_404_410'
  | 'redirect_to_noindex'
  | 'redirect_to_redirect_chain'
  | 'duplicate'
  | 'conflict'
  | 'temporary_should_be_permanent'
  | 'redirect_of_live_page'
  | 'dead_redirect';

export type RedirectIssueSeverity = 'critical' | 'high' | 'medium' | 'low';
export type RedirectIssueStatus = 'open' | 'resolved' | 'deferred';
/** How a fix is applied: mechanical batch, human judgment, or surface-only. */
export type RedirectFixMode = 'batch' | 'judgment' | 'manual';

/** Best-effort evidence backing the ranking (all fields may be null = unknown). */
export interface RedirectIssueEvidence {
  sourceClicks: number | null;
  sourceImpressions: number | null;
  sourceInInventory: boolean | null;
  sourceTransactional: boolean | null;
  targetIndexed: boolean | null;
  targetStatus: string | null; // crawl derivedStatus of the target
  targetInInventory: boolean | null;
  liveFinalStatus: number | null;
  chainLength: number | null;
  cycleCertainty: 'exact' | 'possible' | null;
}

/**
 * A derived redirect issue for the first-sync audit. Survey-only (writes still go
 * through the Phase-2 gate). Deduped across audit runs by a stable `fingerprint`
 * so re-running doesn't churn rows; an open/deferred issue whose condition no
 * longer holds is auto-`resolved`. `detectionVersion` stamps the logic so a re-run
 * after a logic change is comparable (mirrors the crawl MAPPING_VERSION idea).
 */
@Entity('redirect_issues')
@Index('UQ_redirect_issues_fp', ['siteId', 'fingerprint'], { unique: true })
@Index('IDX_redirect_issues_site_status', ['siteId', 'status'])
@Index('IDX_redirect_issues_site_rank', ['siteId', 'rank'])
export class RedirectIssue {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 40 })
  issueType: RedirectIssueType;

  @Column({ type: 'varchar', length: 12 })
  severity: RedirectIssueSeverity;

  @Column({ type: 'varchar', length: 12 })
  fixMode: RedirectFixMode;

  /** Sortable urgency score (higher = more urgent): tier base + traffic weight. */
  @Column({ type: 'bigint', default: 0 })
  rank: string; // bigint → string in TypeORM

  @Column({ type: 'char', length: 64 })
  fingerprint: string;

  /** The primary redirect this issue targets (for single/judgment fixes). */
  @Column({ type: 'uuid', nullable: true })
  primaryRedirectId: string | null;

  /** All redirect_items involved (e.g. a duplicate group or a chain). */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  redirectIds: string[];

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  detail: string | null;

  @Column({ type: 'jsonb', nullable: true })
  evidence: RedirectIssueEvidence | null;

  /** What a fix would do (kind + params) — drives batch/judgment application. */
  @Column({ type: 'jsonb', nullable: true })
  proposedFix: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status: RedirectIssueStatus;

  @Column({ type: 'int', default: 0 })
  detectionVersion: number;

  @Column({ type: 'uuid', nullable: true })
  lastRunId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  firstSeenAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  deferredAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
