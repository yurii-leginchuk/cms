import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { CryptoService } from '../common/crypto/crypto.service';
import { SiteOptimizationConfig, R2Status } from './site-optimization-config.entity';
import { UpdateOptimizationConfigDto } from './dto/update-optimization-config.dto';
import { UpdateR2ConfigDto } from './dto/update-r2-config.dto';
import { R2Credentials } from './r2-helpers';

/**
 * Public (redacted) view of the config. Secrets are NEVER included — only
 * isSet/verified booleans, mirroring settings.service.ts SECRET_KEYS redaction.
 */
export interface OptimizationConfigPublic {
  id: string;
  siteId: string;
  enabled: boolean;
  webpEnabled: boolean;
  quality: number;
  maxWidth: number | null;
  // R2 — write-only creds surfaced only as booleans
  r2AccountIdSet: boolean;
  r2AccessKeyIdSet: boolean;
  r2SecretSet: boolean;
  cfApiTokenSet: boolean;
  r2Bucket: string | null;
  r2Status: R2Status;
  r2VerifiedAt: Date | null;
  r2LastError: string | null;
}

@Injectable()
export class OptimizationConfigService {
  constructor(
    @InjectRepository(SiteOptimizationConfig)
    private readonly configRepo: Repository<SiteOptimizationConfig>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    private readonly crypto: CryptoService,
  ) {}

  async getOrCreate(siteId: string): Promise<SiteOptimizationConfig> {
    const existing = await this.configRepo.findOne({ where: { siteId } });
    if (existing) return existing;

    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');

    return this.configRepo.save(this.configRepo.create({ siteId }));
  }

  /** Redacted view for API responses — never leaks a secret. */
  toPublic(c: SiteOptimizationConfig): OptimizationConfigPublic {
    return {
      id: c.id,
      siteId: c.siteId,
      enabled: c.enabled,
      webpEnabled: c.webpEnabled,
      quality: c.quality,
      maxWidth: c.maxWidth,
      r2AccountIdSet: !!c.r2AccountId,
      r2AccessKeyIdSet: !!c.r2AccessKeyId,
      r2SecretSet: !!c.r2SecretEnc,
      cfApiTokenSet: !!c.cfApiTokenEnc,
      r2Bucket: c.r2Bucket,
      r2Status: c.r2Status,
      r2VerifiedAt: c.r2VerifiedAt,
      r2LastError: c.r2LastError,
    };
  }

  async getPublic(siteId: string): Promise<OptimizationConfigPublic> {
    return this.toPublic(await this.getOrCreate(siteId));
  }

  async update(
    siteId: string,
    dto: UpdateOptimizationConfigDto,
  ): Promise<OptimizationConfigPublic> {
    const config = await this.getOrCreate(siteId);
    if (dto.enabled !== undefined) config.enabled = dto.enabled;
    if (dto.webpEnabled !== undefined) config.webpEnabled = dto.webpEnabled;
    if (dto.quality !== undefined) config.quality = dto.quality;
    if (dto.maxWidth !== undefined) config.maxWidth = dto.maxWidth;
    return this.toPublic(await this.configRepo.save(config));
  }

  /**
   * Store R2 credentials. Secrets are encrypted on write (throws via CryptoService
   * if ENCRYPTION_KEY is missing/short — fail-safe, no plaintext ever stored).
   * Changing any credential resets verification to `untested`.
   */
  async updateR2(
    siteId: string,
    dto: UpdateR2ConfigDto,
  ): Promise<OptimizationConfigPublic> {
    const config = await this.getOrCreate(siteId);
    let changed = false;

    if (dto.r2AccountId !== undefined) {
      config.r2AccountId = dto.r2AccountId.trim() || null;
      changed = true;
    }
    if (dto.r2AccessKeyId !== undefined) {
      config.r2AccessKeyId = dto.r2AccessKeyId.trim() || null;
      changed = true;
    }
    if (dto.r2Secret) {
      config.r2SecretEnc = this.crypto.encrypt(dto.r2Secret);
      changed = true;
    }
    if (dto.cfApiToken) {
      config.cfApiTokenEnc = this.crypto.encrypt(dto.cfApiToken);
      changed = true;
    }

    if (changed) {
      config.r2Status = R2Status.UNTESTED;
      config.r2VerifiedAt = null;
      config.r2LastError = null;
    }
    return this.toPublic(await this.configRepo.save(config));
  }

  /** Persist a mutated config (used by the setup service after test/create-bucket). */
  async save(config: SiteOptimizationConfig): Promise<SiteOptimizationConfig> {
    return this.configRepo.save(config);
  }

  /** Decrypt the CF API token (server-side only, for bucket admin). */
  decryptCfToken(config: SiteOptimizationConfig): string | null {
    return config.cfApiTokenEnc ? this.crypto.decrypt(config.cfApiTokenEnc) : null;
  }

  /**
   * Assemble decrypted S3 credentials, or null if the config is incomplete.
   * Decryption happens ONLY here, server-side; the plaintext never leaves.
   */
  getDecryptedCreds(config: SiteOptimizationConfig): R2Credentials | null {
    if (
      !config.r2AccountId ||
      !config.r2AccessKeyId ||
      !config.r2SecretEnc ||
      !config.r2Bucket
    ) {
      return null;
    }
    return {
      accountId: config.r2AccountId,
      accessKeyId: config.r2AccessKeyId,
      secretAccessKey: this.crypto.decrypt(config.r2SecretEnc),
      bucket: config.r2Bucket,
    };
  }
}
