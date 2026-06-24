import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Page } from '../pages/page.entity';

/**
 * Immutable snapshot of the exact schema set pushed to WordPress on each publish.
 * Powers an audit trail and (future) rollback — re-pushing an older snapshot.
 */
@Entity('schema_history')
export class SchemaHistory {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Index()
  @Column({ type: 'uuid' })
  pageId: string;

  /** The published set: [{ type, jsonld }]. */
  @Column({ type: 'jsonb' })
  snapshot: { type: string; jsonld: unknown }[];

  @Column({ type: 'int', default: 0 })
  count: number;

  @CreateDateColumn()
  createdAt: Date;

  @ManyToOne(() => Page, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pageId' })
  page: Page;
}
