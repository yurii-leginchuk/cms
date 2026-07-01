import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { DerivedStatus } from './crawl-normalize';

/**
 * Mutable, one-row-per-URL current-state projection for fast list reads. The
 * append-only history lives in `crawl_inspections`; this table is the "latest
 * known state" fast path. `pageId` is nullable because a URL Google knows about
 * may not (yet) be in our `pages` inventory.
 *
 * Two clocks, never merged:
 *  - `googleLastCrawlTime` — Google's clock (may be weeks stale).
 *  - `lastInspectedAt`     — OUR clock (freshness of this row).
 * `isIndexed` is a TERNARY: true / false / null(=never inspected or unknown).
 */
@Entity('crawl_page_status')
@Index('UQ_crawl_page_status_url', ['siteId', 'url'], { unique: true })
@Index('IDX_crawl_page_status_site_status', ['siteId', 'derivedStatus'])
export class CrawlPageStatus {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid', nullable: true })
  pageId: string | null;

  @Column({ type: 'varchar', length: 2048 })
  url: string;

  @Column({ type: 'varchar', length: 40, nullable: true })
  derivedStatus: DerivedStatus | null;

  /** true / false / null(never inspected or indeterminate). */
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

  /** Google's clock — when Google says it last crawled the page. */
  @Column({ type: 'timestamptz', nullable: true })
  googleLastCrawlTime: Date | null;

  /** Our clock — when WE last inspected (data freshness). null = never. */
  @Column({ type: 'timestamptz', nullable: true })
  lastInspectedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  firstSeenAt: Date | null;

  @Column({ type: 'char', length: 64, nullable: true })
  stateHash: string | null;

  @Column({ type: 'int', default: 0 })
  mappingVersion: number;

  @Column({ type: 'varchar', length: 64, nullable: true })
  apiVersion: string | null;

  @Column({ type: 'uuid', nullable: true })
  lastRunId: string | null;

  /** Last inspection error (quota/permission/transport), if the latest attempt failed. */
  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
