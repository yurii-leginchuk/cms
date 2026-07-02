import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AuditCheckType =
  | 'noindex_regression'
  | 'robots_txt_regression'
  | 'sitemap_broken'
  | 'money_page_regression'
  | 'soft_404_suspect'
  | 'https_regression'
  | 'canonical_hijack';

export type AuditSeverity = 'critical' | 'warning' | 'notice';
export type AuditFindingStatus = 'open' | 'resolved' | 'muted' | 'accepted';

export interface AffectedUrl {
  url: string;
  pageId?: string | null;
}

/** Snapshot taken at mute/accept time — drives auto-resurface on worsening. */
export interface MuteSnapshot {
  severity: AuditSeverity;
  affectedCount: number;
}

/**
 * Mutable current state — one row per stable finding, unique `(siteId,
 * fingerprint)`. Clones + hardens the `redirect_issues` pattern: identity is
 * the SUBJECT (checkType + subjectKey [+ discriminator]), never the observed
 * value, so evidence can change without churning the row. Resolution is gated:
 * `resolvedAt` may only be set with `resolutionBasis='verified_absent'` — a
 * subject not re-evaluated this run stays open (computed `unconfirmed`), never
 * silently resolved (deliberately NOT the redirect-audit auto-resolve).
 */
@Entity('audit_findings')
@Index('UQ_audit_findings_fp', ['siteId', 'fingerprint'], { unique: true })
@Index('IDX_audit_findings_site_status', ['siteId', 'status'])
@Index('IDX_audit_findings_site_check', ['siteId', 'checkType'])
export class AuditFinding {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  /** sha256(checkType:subjectKey[:discriminator]) — see audit-fingerprint.ts. */
  @Column({ type: 'char', length: 64 })
  fingerprint: string;

  @Column({ type: 'varchar', length: 40 })
  checkType: AuditCheckType;

  /** Deterministic, from the versioned detector — AI may only SUGGEST later. */
  @Column({ type: 'varchar', length: 12 })
  severity: AuditSeverity;

  @Column({ type: 'varchar', length: 12, default: 'open' })
  status: AuditFindingStatus;

  /** Normalized URL, 'site', or a collision key (see fingerprint rules). */
  @Column({ type: 'varchar', length: 2048 })
  subjectKey: string;

  @Column({ type: 'text' })
  title: string;

  /** Verbatim evidence envelope — server values only, never AI-authored. */
  @Column({ type: 'jsonb', nullable: true })
  evidence: Record<string, unknown> | null;

  /** Mutable member list (for group findings) — NOT part of identity. */
  @Column({ type: 'jsonb', default: () => `'[]'` })
  affectedUrls: AffectedUrl[];

  @Column({ type: 'timestamptz', nullable: true })
  firstSeenAt: Date | null;

  /** Condition last confirmed PRESENT. */
  @Column({ type: 'timestamptz', nullable: true })
  lastObservedAt: Date | null;

  /** Subject last actually checked (even if still failing) — anti-flapping. */
  @Column({ type: 'timestamptz', nullable: true })
  lastEvaluatedAt: Date | null;

  @Column({ type: 'uuid', nullable: true })
  lastEvaluatedRunId: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  /** 'verified_absent' only — never "not seen this run". */
  @Column({ type: 'varchar', length: 24, nullable: true })
  resolutionBasis: string | null;

  /** resolved → reappeared counter. */
  @Column({ type: 'int', default: 0 })
  regressionCount: number;

  @Column({ type: 'int', default: 0 })
  detectorVersion: number;

  /** Phase 3 — grounded AI interpretation (hypothesis, stored separately). */
  @Column({ type: 'jsonb', nullable: true })
  aiAnalysis: Record<string, unknown> | null;

  @Column({ type: 'text', nullable: true })
  muteReason: string | null;

  @Column({ type: 'timestamptz', nullable: true })
  mutedAt: Date | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  mutedBy: string | null;

  /** State at mute/accept time — auto-resurface when severity rises or the
   *  affected set grows >50% (locked decision D5). */
  @Column({ type: 'jsonb', nullable: true })
  muteSnapshot: MuteSnapshot | null;

  /** Phase 3 — linked Asana task (dedupe: one open task per fingerprint). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  asanaTaskGid: string | null;

  /** Computed CMS deep-link route; null ⇒ task-only (button hidden in UI). */
  @Column({ type: 'varchar', length: 512, nullable: true })
  fixRoute: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
