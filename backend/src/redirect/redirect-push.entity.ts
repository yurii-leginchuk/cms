import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';
import { McpChangeAction } from '../mcp-changes/mcp-change-request.entity';

export enum RedirectPushStatus {
  PENDING = 'pending',
  PROCESSING = 'processing',
  SUCCESS = 'success',
  FAILED = 'failed',
}

/**
 * Append/updatable ledger of every CMS→WP redirect write, following the
 * `sync_jobs` idempotent-retry pattern (attempts / maxAttempts / nextRetryAt).
 * One row per approved change request: the gate's accept() runs the push once;
 * a transient failure is retried by a cron until `maxAttempts`. `verifyOk`
 * records the verify-after re-read (did WP end up with what we intended?).
 */
@Entity('redirect_pushes')
@Index('IDX_redirect_pushes_change', ['changeRequestId'], { unique: true })
@Index('IDX_redirect_pushes_retry', ['status', 'nextRetryAt'])
export class RedirectPush {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  /** The gate change request this push fulfils (unique — idempotency key). */
  @Column({ type: 'uuid' })
  changeRequestId: string;

  /** The redirect_items row affected (null for a create until we know it). */
  @Column({ type: 'uuid', nullable: true })
  redirectItemId: string | null;

  /** Redirection's own id once known (null before a create lands). */
  @Column({ type: 'int', nullable: true })
  pluginId: number | null;

  @Column({ type: 'varchar', length: 24 })
  action: McpChangeAction;

  @Column({ type: 'enum', enum: RedirectPushStatus, default: RedirectPushStatus.PENDING })
  status: RedirectPushStatus;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'int', default: 4 })
  maxAttempts: number;

  /** Earliest time a retry cron may pick this up again (null = not scheduled). */
  @Column({ type: 'timestamptz', nullable: true })
  nextRetryAt: Date | null;

  @Column({ type: 'text', nullable: true })
  lastError: string | null;

  /** Verify-after result: did the re-read confirm the intended state landed? */
  @Column({ type: 'boolean', nullable: true })
  verifyOk: boolean | null;

  @Column({ type: 'timestamptz', nullable: true })
  appliedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
