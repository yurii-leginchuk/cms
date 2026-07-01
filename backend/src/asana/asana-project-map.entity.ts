import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Site } from '../sites/site.entity';

/**
 * Per-site → Asana project mapping (one project per site, the locked program
 * decision) plus the webhook state used from Phase 3. Phase 1 only sets
 * `projectGid`/`projectName` and stamps `lastFullSyncAt` on "Sync now".
 *
 * `webhookSecretEnc` is AES-256-GCM encrypted at rest, never returned.
 */
export type AsanaWebhookStatus = 'none' | 'pending' | 'active' | 'error';

@Entity('asana_project_map')
export class AsanaProjectMap {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 64, nullable: true })
  projectGid: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  projectName: string | null;

  // ── Webhook state (Phase 3) ─────────────────────────────────────────────────

  @Column({ type: 'varchar', length: 64, nullable: true })
  webhookGid: string | null;

  /** Shared secret from the X-Hook-Secret handshake — encrypted, never returned. */
  @Column({ type: 'text', nullable: true })
  webhookSecretEnc: string | null;

  @Column({ type: 'varchar', length: 16, default: 'none' })
  webhookStatus: AsanaWebhookStatus;

  @Column({ type: 'timestamp', nullable: true })
  webhookLastReceivedAt: Date | null;

  // ── Sync freshness ──────────────────────────────────────────────────────────

  @Column({ type: 'timestamp', nullable: true })
  lastFullSyncAt: Date | null;

  /** Last sync failure reason (scrubbed). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  syncError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site: Site;
}
