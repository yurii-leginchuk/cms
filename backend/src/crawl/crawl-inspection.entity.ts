import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';
import type { DerivedStatus } from './crawl-normalize';

/**
 * Append-only ledger — ONE row per observed state CHANGE (deduped by
 * `stateHash`, which excludes lastCrawlTime). Stores the FULL raw API payload
 * so a mapping bug can be re-normalized retroactively without re-spending quota.
 * This is the source of truth for the change-log / deindexation history (Phase 2
 * reads it); Phase 1 writes it and shows it as a per-page timeline.
 */
@Entity('crawl_inspections')
@Index('IDX_crawl_inspections_url_time', ['siteId', 'url', 'observedAt'])
@Index('IDX_crawl_inspections_run', ['runId'])
export class CrawlInspection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid', nullable: true })
  pageId: string | null;

  @Column({ type: 'varchar', length: 2048 })
  url: string;

  @Column({ type: 'uuid', nullable: true })
  runId: string | null;

  /** OUR clock — when this observation was recorded. */
  @Column({ type: 'timestamptz', default: () => 'now()' })
  observedAt: Date;

  /** Full inspectionResult payload, verbatim, for retroactive re-normalization. */
  @Column({ type: 'jsonb', nullable: true })
  rawPayload: unknown;

  @Column({ type: 'varchar', length: 40, nullable: true })
  derivedStatus: DerivedStatus | null;

  /** The derived status BEFORE this change (null on first-seen) — powers the
   *  change analyzer's from→to transitions without a self-join. */
  @Column({ type: 'varchar', length: 40, nullable: true })
  prevDerivedStatus: DerivedStatus | null;

  @Column({ type: 'boolean', nullable: true })
  isIndexed: boolean | null;

  @Column({ type: 'text', nullable: true })
  coverageStateRaw: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  verdict: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  indexingState: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  robotsTxtState: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  pageFetchState: string | null;

  @Column({ type: 'varchar', length: 40, nullable: true })
  crawledAs: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  googleCanonical: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  userCanonical: string | null;

  @Column({ type: 'boolean', default: false })
  canonicalConflict: boolean;

  @Column({ type: 'timestamptz', nullable: true })
  googleLastCrawlTime: Date | null;

  @Column({ type: 'char', length: 64, nullable: true })
  stateHash: string | null;

  @Column({ type: 'char', length: 64, nullable: true })
  prevStateHash: string | null;

  /** true when this row is a transition from indexed → not-indexed. */
  @Column({ type: 'boolean', default: false })
  isDeindexation: boolean;

  /** true when this is the first time we ever recorded this URL. */
  @Column({ type: 'boolean', default: false })
  isFirstSeen: boolean;

  @Column({ type: 'int', default: 0 })
  mappingVersion: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  apiVersion: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
