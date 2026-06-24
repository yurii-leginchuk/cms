import {
  Entity, PrimaryGeneratedColumn, Column, Index, Unique,
} from 'typeorm';

/**
 * Persisted daily GSC series for a watched keyword (Phase 3.5). Bounded by the
 * user-chosen watched set, so storing per-day rows stays linear — this is what
 * makes keyword history safe to persist without becoming an unbounded query cube.
 *
 * Mirrors `gsc_daily`: rows are zero-filled for every day in a refreshed range
 * so "missing day" reliably means "not yet fetched", and the recent tail is
 * re-pulled because GSC finalizes late. Survives GSC's 16-month window so trends
 * stay reproducible.
 */
@Entity('keyword_daily')
@Index(['watchedKeywordId', 'date'])
@Unique(['watchedKeywordId', 'date'])
export class KeywordDaily {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  watchedKeywordId: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'int', default: 0 })
  clicks: number;

  @Column({ type: 'int', default: 0 })
  impressions: number;

  /** Impression-weighted average position for the day, as GSC returns it. */
  @Column({ type: 'real', default: 0 })
  position: number;

  @Column({ type: 'timestamp', default: () => 'now()' })
  fetchedAt: Date;
}
