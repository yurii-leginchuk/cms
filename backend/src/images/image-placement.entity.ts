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
} from 'typeorm';
import { Site } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { SiteImage } from './site-image.entity';
import { AltQuality } from './alt-quality';

/**
 * One OCCURRENCE of an image on a page — the many-to-many join between
 * SiteImage and Page, carrying the per-page observed alt and the surrounding
 * context used to ground AI generation. Coverage metrics are computed from
 * these rows (per-placement), never from a frozen page counter.
 *
 * A page re-scrape RECONCILES placements (diff, not replace): unchanged rows
 * keep their id, vanished images get `lastSeenAt` left stale, new ones inserted
 * — so a user's draftAlt on the parent SiteImage is never destroyed.
 */
@Entity('image_placements')
@Unique('uq_placement', ['pageId', 'canonicalKey', 'domIndex'])
export class ImagePlacement {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid' })
  siteId: string;

  @Index()
  @Column({ type: 'uuid' })
  imageId: string;

  @Index()
  @Column({ type: 'uuid' })
  pageId: string;

  @Column({ length: 2048 })
  canonicalKey: string;

  /** Exact src as authored on this page (for the inline-HTML rewrite path). */
  @Column({ length: 2048 })
  rawSrc: string;

  /** Disambiguates multiple occurrences of the same file on one page. */
  @Column({ type: 'int', default: 0 })
  domIndex: number;

  /** Verbatim alt observed on THIS page (null = attribute absent ≠ ""). */
  @Column({ type: 'text', nullable: true })
  observedAlt: string | null;

  @Column({ type: 'varchar', length: 20, default: 'absent' })
  quality: AltQuality;

  // ── Grounding context (captured at scrape time, reproducible) ──────────────

  @Column({ type: 'text', nullable: true })
  nearestHeading: string | null;

  @Column({ type: 'text', nullable: true })
  caption: string | null;

  @Column({ type: 'text', nullable: true })
  surroundingText: string | null;

  /** Freshness/lineage: first & last scrape that saw this placement. */
  @Column({ type: 'timestamp', nullable: true })
  firstSeenAt: Date | null;

  @Column({ type: 'timestamp', nullable: true })
  lastSeenAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => SiteImage, (img) => img.placements, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'imageId' })
  image: SiteImage;

  @ManyToOne(() => Page, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pageId' })
  page: Page;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site: Site;
}
