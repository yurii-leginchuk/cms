import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Site } from '../sites/site.entity';
import { ContentStructure } from './content-structure';
import { SchemaDetectionResult } from '../schema/schema-validator';

export enum PageSyncStatus {
  IDLE = 'idle',
  PENDING = 'pending',
  SYNCING = 'syncing',
  SYNCED = 'synced',
  FAILED = 'failed',
}

@Entity('pages')
export class Page {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @ManyToOne(() => Site, (site) => site.pages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site: Site;

  @Column({ length: 2048 })
  url: string;

  @Column({ type: 'text', nullable: true })
  rawHtml: string | null;

  @Column({ type: 'text', nullable: true })
  cleanContent: string | null;

  @Column({ type: 'jsonb', nullable: true })
  contentStructure: ContentStructure | null;

  /** Last JSON-LD detection + schema.org validation snapshot (schema module). */
  @Column({ type: 'jsonb', nullable: true })
  detectedSchemas: SchemaDetectionResult | null;

  @Column({ type: 'timestamp', nullable: true })
  schemaCheckedAt: Date | null;

  @Column({ length: 500, nullable: true })
  metaTitle: string | null;

  @Column({ type: 'text', nullable: true })
  metaDescription: string | null;

  @Column({ type: 'text', nullable: true })
  h1Text: string | null;

  @Column({ length: 500, nullable: true })
  customMetaTitle: string | null;

  @Column({ type: 'text', nullable: true })
  customMetaDescription: string | null;

  @Column({ default: false })
  isTransactional: boolean;

  @Column({ default: false })
  noindex: boolean;

  @Column({ length: 2048, nullable: true })
  canonical: string | null;

  @Column({ type: 'enum', enum: PageSyncStatus, default: PageSyncStatus.IDLE })
  syncStatus: PageSyncStatus;

  @Column({ type: 'text', nullable: true })
  syncError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  syncAppliedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastScrapedAt: Date | null;

  @Column({ type: 'real', array: true, nullable: true, select: false })
  embedding: number[] | null;

  @Column({ type: 'timestamp', nullable: true })
  embeddingUpdatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
