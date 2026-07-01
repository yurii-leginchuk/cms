import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

export type CrawlScanTrigger = 'nightly' | 'on_demand' | 'backfill';

/**
 * Lineage — one row per scan run (nightly rotation or an on-demand batch). Gives
 * every inspection a run to hang off, and records the property + versions +
 * quota + selection strategy so results are reproducible and auditable.
 */
@Entity('crawl_scan_runs')
@Index('IDX_crawl_scan_runs_site', ['siteId', 'startedAt'])
export class CrawlScanRun {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 16 })
  trigger: CrawlScanTrigger;

  @Column({ type: 'varchar', length: 512, nullable: true })
  property: string | null;

  /** sc-domain vs URL-prefix — affects canonical semantics and URL joins. */
  @Column({ type: 'varchar', length: 16, nullable: true })
  propertyType: 'sc_domain' | 'url_prefix' | null;

  @Column({ type: 'timestamptz', default: () => 'now()' })
  startedAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  apiVersion: string | null;

  @Column({ type: 'int', default: 0 })
  mappingVersion: number;

  @Column({ type: 'int', default: 0 })
  quotaBudget: number;

  @Column({ type: 'int', default: 0 })
  pagesSelected: number;

  @Column({ type: 'int', default: 0 })
  pagesInspected: number;

  @Column({ type: 'int', default: 0 })
  pagesChanged: number;

  @Column({ type: 'int', default: 0 })
  pagesSkippedQuota: number;

  @Column({ type: 'int', default: 0 })
  pagesErrored: number;

  @Column({ type: 'jsonb', nullable: true })
  errorBreakdown: Record<string, number> | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  selectionStrategy: string | null;

  @Column({ type: 'text', nullable: true })
  fatalError: string | null;
}
