import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import {
  OptimizationConfigService,
  OptimizationConfigPublic,
} from './optimization-config.service';
import { R2Service } from './r2.service';
import { CloudflareR2AdminService } from './cloudflare-r2-admin.service';
import { R2Status } from './site-optimization-config.entity';
import { deriveBucketName, mapS3Error } from './r2-helpers';

/**
 * Orchestrates the dangerous-but-reversible R2 setup steps: create the bucket
 * (via Cloudflare) and verify the connection with a REAL round-trip. Writes the
 * verification state (verified / failed + specific human reason) onto the config.
 *
 * Kept separate from OptimizationConfigService so the config service stays a
 * pure store (no S3/CF deps) and there are no dependency cycles.
 */
@Injectable()
export class R2SetupService {
  private readonly logger = new Logger(R2SetupService.name);

  constructor(
    private readonly configService: OptimizationConfigService,
    private readonly r2Service: R2Service,
    private readonly cfAdmin: CloudflareR2AdminService,
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
  ) {}

  /**
   * Derive + create the site's R2 bucket via Cloudflare, then store the name.
   * Idempotent (an existing bucket is reused).
   */
  async createBucket(
    siteId: string,
    overrideName?: string,
  ): Promise<{ bucket: string; existed: boolean }> {
    const config = await this.configService.getOrCreate(siteId);
    if (!config.r2AccountId || !config.cfApiTokenEnc) {
      throw new BadRequestException(
        'Set the R2 Account ID and Cloudflare API token before creating a bucket.',
      );
    }
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');

    const token = this.configService.decryptCfToken(config);
    if (!token) {
      throw new BadRequestException('Cloudflare API token is not set.');
    }
    const name = deriveBucketName(
      overrideName?.trim() || site.url || site.name || 'site',
    );

    const res = await this.cfAdmin.createBucket(config.r2AccountId, token, name);

    config.r2Bucket = name;
    await this.configService.save(config);
    this.logger.log(
      `R2 bucket ${res.existed ? 'reused' : 'created'} for site ${siteId}: ${name}`,
    );
    return { bucket: name, existed: res.existed };
  }

  /**
   * REAL write → head → delete round-trip with the S3 keys. Sets r2Status to
   * `verified` (+ r2VerifiedAt) or `failed` (+ a specific, secret-free reason).
   * This is requirement #7's ALERT source.
   */
  async testConnection(siteId: string): Promise<OptimizationConfigPublic> {
    const config = await this.configService.getOrCreate(siteId);
    const creds = this.configService.getDecryptedCreds(config);

    if (!creds) {
      config.r2Status = R2Status.FAILED;
      config.r2LastError =
        'R2 is not fully configured — set the Account ID, Access Key, Secret, and create a bucket first.';
      config.r2VerifiedAt = null;
      return this.configService.toPublic(await this.configService.save(config));
    }

    try {
      await this.r2Service.roundTrip(creds);
      config.r2Status = R2Status.VERIFIED;
      config.r2VerifiedAt = new Date();
      config.r2LastError = null;
    } catch (err) {
      config.r2Status = R2Status.FAILED;
      config.r2VerifiedAt = null;
      config.r2LastError = mapS3Error(err); // scrubbed, human-readable
      this.logger.warn(`R2 test failed for site ${siteId}: ${config.r2LastError}`);
    }
    return this.configService.toPublic(await this.configService.save(config));
  }
}
