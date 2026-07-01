import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

/**
 * The local mirror — one row per Asana task we track for a site. This is what
 * the Task Monitoring page reads (fast, filterable, and the only place a
 * CMS-entity link can live). Kept fresh by "Sync now" (Phase 1) and webhooks
 * (Phase 3).
 *
 * Dual-clock honesty: `asanaModifiedAt` is Asana's own last-modified time;
 * `lastSyncedAt` is when WE last pulled it. They are never merged in the UI.
 *
 * `origin` = how the row entered the mirror: `cms` = a human created it in the
 * CMS; `mcp` = an AI/agent created it; `tracked` = created outside the CMS and
 * adopted for tracking by pasting its URL; `asana` = a transient read-only view
 * (never persisted). So a shared board never blurs who created what.
 */
export type AsanaTaskOrigin = 'asana' | 'cms' | 'mcp' | 'tracked';

@Entity('asana_task')
@Index('IDX_asana_task_site_completed', ['siteId', 'completed'])
@Index('IDX_asana_task_site_section', ['siteId', 'sectionGid'])
@Index('IDX_asana_task_linked', ['linkedEntityType', 'linkedEntityId'])
export class AsanaTask {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 64 })
  projectGid: string;

  @Index({ unique: true })
  @Column({ type: 'varchar', length: 64 })
  taskGid: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', nullable: true })
  notes: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  assigneeGid: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  assigneeName: string | null;

  /** The board section = this task's status column. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sectionGid: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  sectionName: string | null;

  @Column({ type: 'boolean', default: false })
  completed: boolean;

  /** Asana `due_on` (a calendar date, no time). */
  @Column({ type: 'date', nullable: true })
  dueOn: string | null;

  @Column({ type: 'varchar', length: 512, nullable: true })
  permalinkUrl: string | null;

  /** Set ⇒ this row is a subtask of that task. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  parentTaskGid: string | null;

  @Column({ type: 'int', default: 0 })
  numSubtasks: number;

  /** Last hydrated Asana payload — audit/debug. */
  @Column({ type: 'jsonb', nullable: true })
  raw: unknown;

  // ── CMS-entity link (Phase 2 writes this; the column exists from Phase 1) ────

  @Column({ type: 'varchar', length: 32, nullable: true })
  linkedEntityType: string | null;

  @Column({ type: 'varchar', length: 128, nullable: true })
  linkedEntityId: string | null;

  @Column({ type: 'varchar', length: 16, default: 'asana' })
  origin: AsanaTaskOrigin;

  // ── Dual-clock freshness ────────────────────────────────────────────────────

  /** Asana's own last-modified time (their clock). */
  @Column({ type: 'timestamp', nullable: true })
  asanaModifiedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastEventAt: Date | null;

  /** When WE last pulled/reconciled this row (our clock). */
  @Column({ type: 'timestamp', nullable: true })
  lastSyncedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
