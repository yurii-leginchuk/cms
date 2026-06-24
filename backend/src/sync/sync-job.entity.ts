import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Page } from '../pages/page.entity';

export enum SyncJobStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}

@Entity('sync_jobs')
export class SyncJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid' })
  pageId: string;

  @Column({ type: 'enum', enum: SyncJobStatus, default: SyncJobStatus.PENDING })
  status: SyncJobStatus;

  /** How many times we've attempted to call the WP API */
  @Column({ default: 0 })
  attempts: number;

  /** After this many failures the job is permanently FAILED */
  @Column({ default: 4 })
  maxAttempts: number;

  /** Earliest time the cron retry should pick this job up again */
  @Column({ type: 'timestamp', nullable: true })
  nextRetryAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  appliedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Page, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pageId' })
  page: Page;
}
