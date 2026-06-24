import {
  Entity, PrimaryGeneratedColumn, Column, Index,
} from 'typeorm';

export type EffectQueryWindow = 'baseline' | 'result';

/**
 * A per-query snapshot of one optimization effect's GSC performance, captured at
 * the SAME two windows as the parent effect (baseline at apply time, result at
 * measure time). Stored — not recomputed on read — so a historical "which query
 * moved after this change" stays reproducible beyond GSC's 16-month window.
 *
 * Two windows are captured at different times, so each row carries a `window`
 * discriminator; baseline↔result are merged per query at read time.
 *
 * `isRemainder` rows reconcile the disclosed queries back to the page total:
 * GSC drops low-volume ("anonymized") queries at the query dimension, so the
 * disclosed rows never sum to the page's clicks/impressions. The remainder row
 * holds `pageTotal − Σ disclosed`, making the gap explicit instead of looking
 * like a bug.
 */
@Entity('optimization_effect_queries')
@Index(['effectId', 'window'])
export class OptimizationEffectQuery {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  effectId: string;

  @Column({ type: 'varchar', length: 8 })
  window: EffectQueryWindow;

  @Column({ type: 'varchar', length: 255 })
  query: string;

  @Column({ type: 'int', default: 0 })
  clicks: number;

  @Column({ type: 'int', default: 0 })
  impressions: number;

  /** Percent (0..100), matching OptimizationEffect's CTR convention. */
  @Column({ type: 'real', default: 0 })
  ctr: number;

  /** Impression-weighted average position as GSC returns it for the window. */
  @Column({ type: 'real', default: 0 })
  position: number;

  /** The "other / undisclosed queries" reconciliation row (no real query). */
  @Column({ type: 'boolean', default: false })
  isRemainder: boolean;
}
