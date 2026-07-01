import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import {
  OptimizationConfigService,
  OptimizationConfigPublic,
} from './optimization-config.service';
import { CloudflareCdnService } from './cloudflare-cdn.service';
import { CdnPublishService, PublishResult } from './cdn-publish.service';
import { R2Status, DnsStatus } from './site-optimization-config.entity';
import { ProvisionCdnDto } from './dto/provision-cdn.dto';

/**
 * Orchestrates the hard-to-reverse CDN + rewrite steps and OWNS the safety gates:
 *   - provision requires R2 verified;
 *   - enableRewrite requires R2 verified AND DNS active (→ 409 otherwise);
 *   - disableRewrite is the kill-switch (stops rewriting, deletes nothing).
 */
@Injectable()
export class CdnSetupService {
  private readonly logger = new Logger(CdnSetupService.name);

  constructor(
    private readonly configService: OptimizationConfigService,
    private readonly cloudflareCdn: CloudflareCdnService,
    private readonly publishService: CdnPublishService,
  ) {}

  /** Bind the custom domain (requires R2 verified). Cloudflare auto-provisions DNS+TLS. */
  async provision(
    siteId: string,
    dto: ProvisionCdnDto,
  ): Promise<OptimizationConfigPublic> {
    const config = await this.configService.getOrCreate(siteId);
    if (config.r2Status !== R2Status.VERIFIED) {
      throw new ConflictException('Verify the R2 connection before provisioning a CDN domain.');
    }
    if (!config.r2AccountId || !config.r2Bucket || !config.cfApiTokenEnc) {
      throw new BadRequestException('R2 account, bucket, and Cloudflare token must be set first.');
    }

    const token = this.configService.decryptCfToken(config)!;
    config.cdnDomain = dto.cdnDomain.trim().toLowerCase();
    config.cfZoneId = dto.cfZoneId.trim();
    config.dnsStatus = DnsStatus.PENDING;
    config.dnsError = null;
    await this.configService.save(config);

    try {
      await this.cloudflareCdn.bindCustomDomain(
        config.r2AccountId,
        token,
        config.r2Bucket,
        config.cdnDomain,
        config.cfZoneId,
      );
    } catch (err) {
      config.dnsStatus = DnsStatus.ERROR;
      config.dnsError = (err as Error).message;
      await this.configService.save(config);
      throw new BadRequestException(config.dnsError);
    }

    this.logger.log(`CDN domain provisioning started for site ${siteId}: ${config.cdnDomain}`);
    return this.configService.toPublic(config);
  }

  /** Poll Cloudflare and update dnsStatus (pending → active / error). */
  async refreshStatus(siteId: string): Promise<OptimizationConfigPublic> {
    const config = await this.configService.getOrCreate(siteId);
    if (!config.cdnDomain || !config.r2AccountId || !config.r2Bucket || !config.cfApiTokenEnc) {
      return this.configService.toPublic(config);
    }
    const token = this.configService.decryptCfToken(config)!;
    const status = await this.cloudflareCdn.getCustomDomainStatus(
      config.r2AccountId,
      token,
      config.r2Bucket,
      config.cdnDomain,
    );
    config.dnsStatus = status;
    config.dnsError = status === DnsStatus.ERROR ? (config.dnsError ?? 'Domain activation failed or unreachable.') : null;
    await this.configService.save(config);
    return this.configService.toPublic(config);
  }

  /**
   * GATE #1 (server-side): enable live rewriting ONLY when R2 verified AND DNS
   * active — otherwise 409. On success: flip rewriteEnabled, publish the verified
   * CDN map, and turn the plugin toggle on.
   */
  async enableRewrite(
    siteId: string,
  ): Promise<{ config: OptimizationConfigPublic; publish: PublishResult }> {
    const config = await this.configService.getOrCreate(siteId);
    if (config.r2Status !== R2Status.VERIFIED || config.dnsStatus !== DnsStatus.ACTIVE) {
      throw new ConflictException(
        'Rewriting cannot be enabled until R2 is verified and the CDN domain is active.',
      );
    }
    const site = await this.publishService.requireSite(siteId);

    config.rewriteEnabled = true;
    await this.configService.save(config);

    // Publish verified mappings first, THEN turn the plugin on — so when the
    // switch flips, the map is already in place.
    const publish = await this.publishService.publish(config, site);
    await this.publishService.setPluginToggle(site, true);

    this.logger.log(
      `Rewrite ENABLED for site ${siteId}: ${publish.verified} verified mappings published`,
    );
    return { config: this.configService.toPublic(config), publish };
  }

  /** Kill-switch: stop rewriting everywhere. Deletes nothing. */
  async disableRewrite(siteId: string): Promise<OptimizationConfigPublic> {
    const config = await this.configService.getOrCreate(siteId);
    config.rewriteEnabled = false;
    await this.configService.save(config);

    const site = await this.publishService.requireSite(siteId);
    // Best-effort: tell the plugin to stop rewriting. Even if this call fails,
    // the CMS side is already off and no new maps will be published.
    try {
      await this.publishService.setPluginToggle(site, false);
    } catch (err) {
      this.logger.warn(
        `Rewrite disabled in CMS but plugin toggle push failed: ${(err as Error).message}`,
      );
    }
    this.logger.log(`Rewrite DISABLED (kill-switch) for site ${siteId}`);
    return this.configService.toPublic(config);
  }
}
