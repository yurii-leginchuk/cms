import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * Which pages a `pages`-scoped Asana task is credited to on the Impact timeline.
 * Normalized (not a jsonb array) so "which tasks affect page X?" is an indexed
 * join. Rewritten wholesale by AsanaTaskService.setScope.
 */
@Entity('asana_task_page')
@Index('IDX_asana_task_page_task', ['taskGid'])
@Index('IDX_asana_task_page_site_page', ['siteId', 'pageId'])
export class AsanaTaskPage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  /** The Asana task gid (matches asana_task.taskGid). */
  @Column({ type: 'varchar', length: 64 })
  taskGid: string;

  @Column({ type: 'uuid' })
  pageId: string;

  @CreateDateColumn()
  createdAt: Date;
}
