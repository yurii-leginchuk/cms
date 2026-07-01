import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * Atomic daily quota ledger for the GSC URL-Inspection API. The hard ceiling is
 * 2,000 inspections/day/property (and 600/min). We keep ONE row per
 * (property, quotaDate) and enforce the cap atomically so the nightly cron and
 * synchronous on-demand re-checks can never overspend between them.
 *
 * `quotaDate` is bucketed in Google's own quota timezone (America/Los_Angeles),
 * NOT the UTC inspection timestamp — see crawl-quota.service. We budget below the
 * cap nightly (`budgetNightly`) so on-demand always has headroom.
 */
@Entity('crawl_quota_ledger')
@Index('UQ_crawl_quota_property_date', ['property', 'quotaDate'], { unique: true })
export class CrawlQuotaLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', nullable: true })
  siteId: string | null;

  @Column({ type: 'varchar', length: 512 })
  property: string;

  /** Pacific-bucketed date string YYYY-MM-DD (Google's quota reset boundary). */
  @Column({ type: 'date' })
  quotaDate: string;

  @Column({ type: 'int', default: 0 })
  used: number;

  @Column({ type: 'int', default: 2000 })
  capDaily: number;

  @Column({ type: 'int', default: 1500 })
  budgetNightly: number;
}
