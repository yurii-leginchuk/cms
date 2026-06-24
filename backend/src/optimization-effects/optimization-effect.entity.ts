import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

export type OptimizationEffectStatus = 'pending' | 'measured' | 'no_data';

/**
 * A before/after measurement of an applied meta change.
 * Baseline metrics are captured at apply time (28 days BEFORE the change);
 * result metrics are filled in by a cron once enough post-change time has passed.
 */
@Entity('optimization_effects')
@Index(['siteId', 'appliedAt'])
@Index(['status', 'appliedAt'])
export class OptimizationEffect {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid' })
  pageId: string;

  @Column({ length: 2048 })
  pageUrl: string;

  @Column({ type: 'text', nullable: true })
  changeSummary: string | null;

  @Column({ type: 'timestamp' })
  appliedAt: Date;

  // Baseline window (pre-change)
  @Column({ type: 'date' })
  baselineStart: string;

  @Column({ type: 'date' })
  baselineEnd: string;

  @Column({ type: 'int', default: 0 })
  baselineClicks: number;

  @Column({ type: 'int', default: 0 })
  baselineImpressions: number;

  @Column({ type: 'real', default: 0 })
  baselineCtr: number;

  @Column({ type: 'real', default: 0 })
  baselinePosition: number;

  @Column({ default: false })
  baselineHasData: boolean;

  // Result window (post-change) — filled by cron
  @Column({ type: 'date', nullable: true })
  resultStart: string | null;

  @Column({ type: 'date', nullable: true })
  resultEnd: string | null;

  @Column({ type: 'int', nullable: true })
  resultClicks: number | null;

  @Column({ type: 'int', nullable: true })
  resultImpressions: number | null;

  @Column({ type: 'real', nullable: true })
  resultCtr: number | null;

  @Column({ type: 'real', nullable: true })
  resultPosition: number | null;

  @Column({ type: 'timestamp', nullable: true })
  measuredAt: Date | null;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: OptimizationEffectStatus;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
