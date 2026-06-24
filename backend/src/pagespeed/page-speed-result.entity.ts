import {
  Entity, PrimaryGeneratedColumn, Column, ManyToOne,
  JoinColumn, CreateDateColumn, Index,
} from 'typeorm';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';

export type PsiStrategy = 'mobile' | 'desktop';
export type PsiCategory = 'good' | 'needs_improvement' | 'poor';

export function scoreToCategory(score: number): PsiCategory {
  if (score >= 90) return 'good';
  if (score >= 50) return 'needs_improvement';
  return 'poor';
}

@Entity('page_speed_results')
@Index(['siteId', 'strategy', 'fetchedAt'])
@Index(['pageId', 'strategy', 'fetchedAt'])
export class PageSpeedResult {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site: Site;

  @Column({ type: 'uuid' })
  pageId: string;

  @ManyToOne(() => Page, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pageId' })
  page: Page;

  @Column({ length: 10 })
  strategy: PsiStrategy;

  @Column({ type: 'int' })
  performanceScore: number;

  @Column({ length: 20 })
  category: PsiCategory;

  @Column({ type: 'int', nullable: true })
  fcp: number | null;

  @Column({ type: 'int', nullable: true })
  lcp: number | null;

  @Column({ type: 'float', nullable: true })
  cls: number | null;

  @Column({ type: 'int', nullable: true })
  tbt: number | null;

  @Column({ type: 'int', nullable: true })
  si: number | null;

  @Column({ type: 'int', nullable: true })
  ttfb: number | null;

  @Column({ type: 'timestamptz' })
  fetchedAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
