import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * Per-site audit configuration + kill switch (mirrors the optimization/asana
 * settings pattern). `liveFetchBudget` bounds the run's HTTP requests (locked
 * decision D2, default 50/site/run). `aiAnalysisEnabled`/`notifyEmail` are
 * reserved for Phases 3/4 (locked D8: dashboard-only alerts in Phase 1).
 */
@Entity('audit_site_settings')
export class AuditSiteSettings {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'boolean', default: true })
  enabled: boolean;

  @Column({ type: 'int', default: 50 })
  liveFetchBudget: number;

  @Column({ type: 'boolean', default: true })
  aiAnalysisEnabled: boolean;

  @Column({ type: 'jsonb', nullable: true })
  muteDefaults: Record<string, unknown> | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  notifyEmail: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
