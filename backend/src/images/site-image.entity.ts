import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
  Unique,
  OneToMany,
} from 'typeorm';
import { Site } from '../sites/site.entity';
import { ImagePlacement } from './image-placement.entity';
import { AltQuality } from './alt-quality';

/**
 * The CMS-managed ALT state for ONE image (one physical file, deduped across
 * variants and pages) on a site. Mirrors PageSchema's change-state discipline:
 * `status` is the alt's state vs. what's live on WordPress.
 *
 *  - synced       — draftAlt matches live; no pending change
 *  - ai_suggested — AI proposed alt, NOT yet reviewed → must NOT be auto-applied
 *  - modified     — human-edited / approved, pending Apply
 *  - removed      — user cleared the alt (push empty), pending Apply
 *
 * `ai_suggested` is a deliberate EXTRA state beyond the schema module: it is the
 * review-before-apply gate. Bulk Apply excludes ai_suggested rows by default.
 */
export enum ImageAltStatus {
  SYNCED = 'synced',
  AI_SUGGESTED = 'ai_suggested',
  MODIFIED = 'modified',
  REMOVED = 'removed',
}

export enum ImageAltSource {
  ORIGINAL = 'original', // alt observed on the live site (baseline)
  AI_GENERATED = 'ai_generated',
  HUMAN = 'human',
}

@Entity('site_images')
@Unique('uq_site_image_key', ['siteId', 'canonicalKey'])
export class SiteImage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  siteId: string;

  /** Identity key from image-identity.ts — deduped across variants & pages. */
  @Column({ length: 2048 })
  canonicalKey: string;

  /** Best-guess original full-size URL (https, suffixes stripped) — thumbnail. */
  @Column({ length: 2048 })
  canonicalUrl: string;

  /** Authoritative WP identity when reconciled against the Media API (P1). */
  @Column({ type: 'bigint', nullable: true })
  wpAttachmentId: number | null;

  // ── ALT state ───────────────────────────────────────────────────────────

  /** The alt the user/AI is proposing or has applied. null = not set yet. */
  @Column({ type: 'text', nullable: true })
  draftAlt: string | null;

  /** The alt currently observed live (worst/representative across placements).
   *  Kept SEPARATE from draftAlt so a re-scrape never clobbers a user edit. */
  @Column({ type: 'text', nullable: true })
  observedAlt: string | null;

  /** Quality of the current live alt (drives the "missing" work queue). */
  @Column({ type: 'varchar', length: 20, default: 'absent' })
  observedQuality: AltQuality;

  @Column({
    type: 'enum',
    enum: ImageAltStatus,
    default: ImageAltStatus.SYNCED,
  })
  status: ImageAltStatus;

  @Column({
    type: 'enum',
    enum: ImageAltSource,
    default: ImageAltSource.ORIGINAL,
  })
  source: ImageAltSource;

  /** User-flagged decorative → alt="" is the correct, intended outcome. */
  @Column({ type: 'boolean', default: false })
  decorative: boolean;

  // ── AI grounding (mirrors PageSchema) ─────────────────────────────────────

  @Column({ type: 'text', nullable: true })
  aiRationale: string | null;

  /** Context quotes the alt was grounded in (page/section text). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  evidence: string[];

  /** Fields/terms the AI could not ground (surfaced as a banner). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  unverifiedClaims: string[];

  /** True when AI generated from thin/no context → low confidence, needs review. */
  @Column({ type: 'boolean', default: false })
  needsReview: boolean;

  // ── WP sync ───────────────────────────────────────────────────────────────

  @Column({ type: 'timestamp', nullable: true })
  lastPublishedAt: Date | null;

  @Column({ type: 'text', nullable: true })
  publishError: string | null;

  /** Last time this image was seen by a scrape (freshness/lineage). */
  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site: Site;

  @OneToMany(() => ImagePlacement, (p) => p.image)
  placements: ImagePlacement[];
}
