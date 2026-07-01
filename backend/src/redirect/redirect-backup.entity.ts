import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  Index,
  CreateDateColumn,
} from 'typeorm';

export type RedirectBackupReason = 'pre_import' | 'pre_apply' | 'manual';

/**
 * A point-in-time snapshot of ALL of a site's redirects, in the lossless native
 * Redirection JSON. Taken automatically before any bulk apply so an import can be
 * rolled back with one click (restore re-enqueues the backup's redirects through
 * the Phase-2 gate — never a direct WP write).
 */
@Entity('redirect_backups')
@Index('IDX_redirect_backups_site', ['siteId', 'createdAt'])
export class RedirectBackup {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 16 })
  reason: RedirectBackupReason;

  /** Number of redirects captured. */
  @Column({ type: 'int', default: 0 })
  redirectCount: number;

  /** Lossless native Redirection JSON of the site's redirects at capture time. */
  @Column({ type: 'jsonb' })
  content: unknown;

  /** Optional note (e.g. the import filename that triggered it). */
  @Column({ type: 'text', nullable: true })
  note: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
