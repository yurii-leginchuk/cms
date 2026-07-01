import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * The single, global Asana connection. The PAT is workspace-scoped (not
 * per-site), so — like the `settings` table — it lives once. There is exactly
 * one row; services get-or-create it.
 *
 * `patEnc` is AES-256-GCM encrypted at rest (ENCRYPTION_KEY from env) and is
 * NEVER returned to the client — the API exposes only a `patSet` boolean plus
 * the (non-secret) workspace + verification state.
 */
export type AsanaConnStatus = 'untested' | 'verified' | 'failed';

@Entity('asana_connection')
export class AsanaConnection {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Personal Access Token — encrypted, never returned. */
  @Column({ type: 'text', nullable: true })
  patEnc: string | null;

  /** The pinned workspace this connection operates in. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  workspaceGid: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  workspaceName: string | null;

  /** Identity behind the token (from GET /users/me) — for attribution surfacing. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  userGid: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  userName: string | null;

  /** Verification state of the token (drives the "reconnect" alert). */
  @Column({ type: 'varchar', length: 16, default: 'untested' })
  status: AsanaConnStatus;

  @Column({ type: 'timestamp', nullable: true })
  verifiedAt: Date | null;

  /** Last human-readable failure reason (scrubbed — never a raw token/body). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  lastError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
