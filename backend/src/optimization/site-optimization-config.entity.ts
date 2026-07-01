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
 * PHASE 2 (this file) adds the R2 upload credentials + bucket + verification
 * state. `*Enc` fields are AES-256-GCM encrypted at rest (ENCRYPTION_KEY from
 * env) and are NEVER returned to the client (the API exposes only isSet/verified
 * booleans). `r2AccountId` / `r2AccessKeyId` are not decryptable secrets but are
 * still redacted from API responses (write-only in the UI).
 *
 * PHASE 3 (this file) adds the CDN custom-domain + DNS status + the rewrite
 * kill-switch. Rewrite cannot be enabled unless R2 is verified AND DNS is active
 * (enforced server-side).
 */
export enum R2Status {
  UNTESTED = 'untested',
  VERIFIED = 'verified',
  FAILED = 'failed',
}

export enum DnsStatus {
  NONE = 'none',
  PENDING = 'pending',
  ACTIVE = 'active',
  ERROR = 'error',
}

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

  // ── R2 credentials + bucket (Phase 2) ──────────────────────────────────────
  // One account-level R2 Access Key/Secret is reused across a client's sites,
  // but is still stored PER SITE (user pastes the same value). No key minting.

  /** Cloudflare account id (not a secret, but redacted from API responses). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  r2AccountId: string | null;

  /** R2 S3 Access Key ID (semi-secret; redacted from API responses). */
  @Column({ type: 'varchar', length: 128, nullable: true })
  r2AccessKeyId: string | null;

  /** R2 S3 Secret Access Key — AES-256-GCM encrypted at rest, never returned. */
  @Column({ type: 'text', nullable: true })
  r2SecretEnc: string | null;

  /** Cloudflare API token (Workers R2 Storage: Edit) — encrypted, never returned. */
  @Column({ type: 'text', nullable: true })
  cfApiTokenEnc: string | null;

  /** Bucket name (auto-created by the CMS; DNS-safe, 3-63 chars). */
  @Column({ type: 'varchar', length: 63, nullable: true })
  r2Bucket: string | null;

  /** Verification state of the R2 connection (drives the R2-down alert). */
  @Column({ type: 'enum', enum: R2Status, default: R2Status.UNTESTED })
  r2Status: R2Status;

  @Column({ type: 'timestamp', nullable: true })
  r2VerifiedAt: Date | null;

  /** Last human-readable failure reason (scrubbed — never a raw secret/body). */
  @Column({ type: 'varchar', length: 255, nullable: true })
  r2LastError: string | null;

  // ── CDN custom domain + live rewrite (Phase 3) ─────────────────────────────

  /** Custom domain bound to the bucket, e.g. cdn.client.com. */
  @Column({ type: 'varchar', length: 255, nullable: true })
  cdnDomain: string | null;

  /** Cloudflare zone id that owns cdnDomain (same account as the bucket). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  cfZoneId: string | null;

  /** Provisioning state of the custom domain (Cloudflare auto-provisions DNS+TLS). */
  @Column({ type: 'enum', enum: DnsStatus, default: DnsStatus.NONE })
  dnsStatus: DnsStatus;

  @Column({ type: 'varchar', length: 255, nullable: true })
  dnsError: string | null;

  /**
   * The LIVE kill-switch. Cannot be set true unless r2Status=verified AND
   * dnsStatus=active (enforced server-side). false = plugin serves originals.
   */
  @Column({ type: 'boolean', default: false })
  rewriteEnabled: boolean;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site: Site;
}
