import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Page } from '../pages/page.entity';

@Entity('page_chunks')
@Index(['siteId'])
@Index(['pageId'])
export class PageChunk {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  pageId: string;

  @ManyToOne(() => Page, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pageId' })
  page: Page;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'int' })
  chunkIndex: number;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'real', array: true, nullable: true, select: false })
  embedding: number[] | null;

  @Column({ type: 'timestamp', nullable: true })
  embeddingUpdatedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  parentText: string | null;
}
