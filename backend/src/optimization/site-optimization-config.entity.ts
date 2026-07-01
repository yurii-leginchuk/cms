import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { Site } from '../sites/site.entity';

/**
 * Per-site image-optimization configuration. Each site is independent.
 *
 * PHASE 1 carries only the local processing knobs (enable, WebP on/off,
 * quality, resize max-width) — there is NO external infrastructure yet.
 *
 * PHASE 2 will ADD (via a later migration, so these slot in cleanly):
 *   r2AccountId / r2AccessKeyId / r2SecretEnc / r2Bucket / r2Status
 *   cdnDomain / cfApiTokenEnc / cfZoneId / dnsStatus / rewriteEnabled
 * The `*Enc` fields are AES-256-GCM encrypted at rest (ENCRYPTION_KEY from env)
 * and are NEVER returned to the client — this entity is the single home for
 * that credential state so the dangerous-setup state machine lives in one place.
 */
@Entity('site_optimization_config')
export class SiteOptimizationConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ type: 'uuid' })
  siteId: string;

  /** Master switch for the whole optimization feature on this site. */
  @Column({ type: 'boolean', default: false })
  enabled: boolean;

  /** Convert to WebP (true) or fall back to mozjpeg JPEG (false). */
  @Column({ type: 'boolean', default: true })
  webpEnabled: boolean;

  /** WebP/JPEG quality target, 1-100. 80 ≈ TinyPNG visually-lossless. */
  @Column({ type: 'int', default: 80 })
  quality: number;

  /** Downscale images WIDER than this; narrower ones are untouched. null = no resize. */
  @Column({ type: 'int', nullable: true, default: 1600 })
  maxWidth: number | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site: Site;
}
