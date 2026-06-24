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
import { SchemaIssue, SchemaValidity } from './schema-validator';

/**
 * The CMS-managed schema set for a page — the single source of truth. Rows are
 * created by detection (auto-persisted live baseline), the AI "Analyze" pass, or
 * manual authoring; "Apply" pushes the current set to WordPress.
 *
 * `status` is the per-row change-state vs. what's live on WordPress:
 *  - `synced`   — matches live / freshly detected baseline (NOT a pending change)
 *  - `modified` — newly added or edited, pending Apply
 *  - `removed`  — soft-deleted, pending Apply (Apply hard-removes the row)
 */
export enum PageSchemaStatus {
  SYNCED = 'synced',
  MODIFIED = 'modified',
  REMOVED = 'removed',
}

export enum PageSchemaSource {
  AI_GENERATED = 'ai_generated',
  AI_FIXED = 'ai_fixed',
  HUMAN = 'human',
  IMPORTED = 'imported',
}

@Entity('page_schemas')
export class PageSchema {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid' })
  pageId: string;

  @Column({ length: 200 })
  type: string;

  @Column({ type: 'jsonb' })
  jsonld: unknown;

  @Column({ type: 'enum', enum: PageSchemaStatus, default: PageSchemaStatus.SYNCED })
  status: PageSchemaStatus;

  @Column({ type: 'enum', enum: PageSchemaSource, default: PageSchemaSource.HUMAN })
  source: PageSchemaSource;

  @Column({ type: 'varchar', length: 20, default: 'unvalidated' })
  validationStatus: SchemaValidity | 'unvalidated';

  @Column({ type: 'jsonb', default: () => "'[]'" })
  validationResult: SchemaIssue[];

  /** Why the AI proposed / fixed this (grounding discipline). */
  @Column({ type: 'text', nullable: true })
  aiRationale: string | null;

  /** Quotes / anchors backing the schema's fields. */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  evidence: string[];

  /** Fields the AI could not ground (surfaced as a banner, like briefs). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  unverifiedClaims: string[];

  /** Last successful push to WordPress (null until published). */
  @Column({ type: 'timestamp', nullable: true })
  lastPublishedAt: Date | null;

  /** Error from the most recent failed publish attempt. */
  @Column({ type: 'text', nullable: true })
  publishError: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Page, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pageId' })
  page: Page;
}
