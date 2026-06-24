import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
} from 'typeorm';

/**
 * A persisted daily Search Console data point powering the Optimization Impact
 * timeline. Stored (rather than always re-pulled) so long date ranges and CSV
 * export stay stable and reproducible beyond GSC's 16-month window and the 24h
 * query cache.
 *
 * One row per (site, scope, page, day). `scope='global'` rows have `pageUrl=''`.
 * Branded/non-branded are stored side-by-side: `clicks/impressions/position` is
 * ALL traffic; `nb*` is non-branded (everything not matching the site's brand
 * terms). `hasBrandSplit=false` means no brand terms were configured, so the nb*
 * columns mirror the totals.
 */
@Entity('gsc_daily')
@Index('UQ_gsc_daily_scope', ['siteId', 'scope', 'pageUrl', 'date'], { unique: true })
@Index('IDX_gsc_daily_site_date', ['siteId', 'date'])
export class GscDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 8, default: 'global' })
  scope: 'global' | 'page';

  @Column({ type: 'varchar', length: 2048, default: '' })
  pageUrl: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'int', default: 0 })
  clicks: number;

  @Column({ type: 'int', default: 0 })
  impressions: number;

  @Column({ type: 'real', default: 0 })
  position: number;

  @Column({ type: 'int', default: 0 })
  nbClicks: number;

  @Column({ type: 'int', default: 0 })
  nbImpressions: number;

  @Column({ type: 'real', default: 0 })
  nbPosition: number;

  @Column({ type: 'boolean', default: false })
  hasBrandSplit: boolean;

  @Column({ type: 'timestamp', default: () => 'now()' })
  fetchedAt: Date;
}
