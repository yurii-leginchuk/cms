import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  OneToOne,
  JoinColumn,
} from 'typeorm';
import { SiteImage } from '../images/site-image.entity';
import { bigintTransformer } from './numeric.transformer';

/**
 * The CURRENT-STATE optimization projection for ONE image — a 1:1 companion to
 * `SiteImage`, keyed by `imageId`, so it inherits the deduped image identity
 * (one row per physical file) rather than creating a parallel inventory.
 *
 * This is the "stock": exactly one row per image, always reflecting the latest
 * optimization outcome. Site totals ("how much are we saving right now?") are
 * computed from THESE rows and NEVER by summing run events (analyst P0-2) —
 * summing events double-counts every re-optimization.
 *
 * `state` partitions the library with no overlap at a point in time. `stale` is
 * deliberately NOT a persisted state: it is DERIVED by comparing
 * `settingsFingerprint` against the config's current fingerprint, so a settings
 * change can never leave a frozen-stale row behind (analyst P0-3).
 *
 * PHASE 2 (this file) adds r2Key + r2Uploaded — the upload facts, kept separate
 * from "optimized" (local encode success). PHASE 3 will ADD rewriteLive /
 * rewriteVerifiedAt (the live-serving facts).
 */
export enum ImageOptimizationState {
  NOT_OPTIMIZED = 'not_optimized',
  QUEUED = 'queued',
  OPTIMIZING = 'optimizing',
  OPTIMIZED = 'optimized',
  SKIPPED = 'skipped',
  FAILED = 'failed',
}

/** Why an image was skipped (a SUCCESS outcome — original kept, savings = 0). */
export type ImageSkipReason = 'animated' | 'svg' | 'output_larger' | 'unsupported';

/** Which phase failed, for the failures drawer. */
export type ImageFailurePhase = 'fetch' | 'decode' | 'encode';

@Entity('image_optimization')
export class ImageOptimization {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** 1:1 with SiteImage. CASCADE: deleting the image drops its optimization. */
  @Index({ unique: true })
  @Column({ type: 'uuid' })
  imageId: string;

  @Index()
  @Column({ type: 'uuid' })
  siteId: string;

  @Column({
    type: 'enum',
    enum: ImageOptimizationState,
    default: ImageOptimizationState.NOT_OPTIMIZED,
  })
  state: ImageOptimizationState;

  /** Physical measurement of the source bytes we fetched. Immutable (analyst P0-5). */
  @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
  originalBytes: number | null;

  /** Physical measurement of the optimized artifact. == originalBytes when skipped. */
  @Column({ type: 'bigint', nullable: true, transformer: bigintTransformer })
  optimizedBytes: number | null;

  /** 'webp' | 'jpeg' — the output encoder used (null until optimized). */
  @Column({ type: 'varchar', length: 16, nullable: true })
  outputFormat: string | null;

  @Column({ type: 'int', nullable: true })
  outputWidth: number | null;

  @Column({ type: 'int', nullable: true })
  outputHeight: number | null;

  /** sha256 of the exact source bytes — detects content change at the same URL. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  sourceHash: string | null;

  /** Hash of {quality, webp, maxWidth, encoder version} in effect at optimize time. */
  @Column({ type: 'varchar', length: 64, nullable: true })
  settingsFingerprint: string | null;

  @Column({ type: 'varchar', length: 20, nullable: true })
  skipReason: ImageSkipReason | null;

  @Column({ type: 'varchar', length: 10, nullable: true })
  failurePhase: ImageFailurePhase | null;

  @Column({ type: 'text', nullable: true })
  failureError: string | null;

  /** When we fetched the bytes we optimized (lineage). */
  @Column({ type: 'timestamp', nullable: true })
  sourceFetchedAt: Date | null;

  /** When the optimized artifact was produced. */
  @Column({ type: 'timestamp', nullable: true })
  optimizedAt: Date | null;

  /** The run that last touched this row (audit trail). */
  @Column({ type: 'uuid', nullable: true })
  lastRunId: string | null;

  // ── R2 upload facts (Phase 2) ───────────────────────────────────────────────
  /** Object key of the optimized artifact in the site's R2 bucket (content-hashed). */
  @Column({ type: 'varchar', length: 512, nullable: true })
  r2Key: string | null;

  /** True once the optimized artifact is uploaded AND HEAD-verified in R2. */
  @Column({ type: 'boolean', default: false })
  r2Uploaded: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToOne(() => SiteImage, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'imageId' })
  image: SiteImage;
}
