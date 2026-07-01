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

/**
 * Robots `index` directive — Yoast tri-state (`_yoast_wpseo_meta-robots-noindex`):
 *  - DEFAULT  → key absent      → page follows the post-type default in Yoast.
 *  - INDEX    → '2'             → explicit "force index" (rare; pins the page).
 *  - NOINDEX  → '1'             → explicit noindex.
 * The legacy boolean `Page.noindex` is kept in sync (true ⇔ NOINDEX) so the AI
 * agent / chat / embedding code that reads it keeps working unchanged.
 */
export enum IndexDirective {
  DEFAULT = 'default',
  INDEX = 'index',
  NOINDEX = 'noindex',
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

  /**
   * Legacy boolean noindex intent — kept for the agent/chat/embedding code.
   * Mirrors `indexDirective === NOINDEX`. New code should prefer indexDirective.
   */
  @Column({ default: false })
  noindex: boolean;

  /** Robots index directive (tri-state) — authoritative for the Yoast push. */
  @Column({ type: 'enum', enum: IndexDirective, default: IndexDirective.DEFAULT })
  indexDirective: IndexDirective;

  /** Robots nofollow override. false = follow (Yoast default), true = nofollow. */
  @Column({ default: false })
  nofollow: boolean;

  @Column({ length: 2048, nullable: true })
  canonical: string | null;

  // ── Open Graph overrides (blank ⇒ inherit Yoast's title/description) ────────

  @Column({ length: 500, nullable: true })
  ogTitle: string | null;

  @Column({ type: 'text', nullable: true })
  ogDescription: string | null;

  /** Full URL of the OG image (`_yoast_wpseo_opengraph-image`). */
  @Column({ length: 2048, nullable: true })
  ogImage: string | null;

  /** Media-library attachment id (`_yoast_wpseo_opengraph-image-id`); null for
   *  externally-hosted URLs. Set together with ogImage when picked from library. */
  @Column({ type: 'bigint', nullable: true })
  ogImageId: number | null;

  /**
   * Snapshot of the override fields the CMS LAST successfully pushed to WP
   * (the managed keys/values from {@link buildManagedMeta}). Lets the sync push
   * an explicit empty for a field the CMS applied before but the user has since
   * cleared — so it's actually deleted on WP — while still OMITTING (and thus
   * never clobbering) fields the CMS has never managed on this page.
   */
  @Column({ type: 'jsonb', nullable: true })
  lastSyncedMeta: Record<string, string | number> | null;

  @Column({ type: 'enum', enum: PageSyncStatus, default: PageSyncStatus.IDLE })
  syncStatus: PageSyncStatus;

  @Column({ type: 'text', nullable: true })
  syncError: string | null;

  @Column({ type: 'timestamp', nullable: true })
  syncAppliedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastScrapedAt: Date | null;

  /**
   * Sitemap tombstone: set when a parse no longer finds this URL in the site's
   * sitemap (cleared when it reappears). The row is kept — history/metrics stay
   * — but quota-bounded work (index inspection rotation) skips tombstoned pages.
   */
  @Column({ type: 'timestamp', nullable: true })
  missingFromSitemapAt: Date | null;

  @Column({ type: 'real', array: true, nullable: true, select: false })
  embedding: number[] | null;

  @Column({ type: 'timestamp', nullable: true })
  embeddingUpdatedAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
