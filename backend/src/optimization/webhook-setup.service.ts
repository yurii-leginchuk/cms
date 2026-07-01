import {
  Injectable,
  Logger,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Site } from '../sites/site.entity';
import {
  OptimizationConfigService,
  OptimizationConfigPublic,
} from './optimization-config.service';
import { CdnPublishService } from './cdn-publish.service';

/**
 * "Connect uploads" orchestration: generate the webhook secret, push
 * {callbackUrl, secret, enabled} to the plugin, and turn the plugin's automation
 * switch on so new uploads fire the webhook. Disconnect reverses it.
 *
 * The callback URL is built from CMS_PUBLIC_URL (the CMS origin the WordPress
 * site can reach) and encodes the siteId.
 */
@Injectable()
export class WebhookSetupService {
  private readonly logger = new Logger(WebhookSetupService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    private readonly configService: OptimizationConfigService,
    private readonly cdnPublishService: CdnPublishService,
    private readonly config: ConfigService,
  ) {}

  private callbackUrl(siteId: string): string {
    const base = (this.config.get<string>('CMS_PUBLIC_URL') || '').replace(/\/+$/, '');
    if (!base) {
      throw new BadRequestException(
        'CMS_PUBLIC_URL is not configured — set it so WordPress can reach the webhook.',
      );
    }
    return `${base}/api/webhooks/optimization/${siteId}/new-image`;
  }

  private async requireSite(siteId: string): Promise<Site> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    if (!site.wpApiKey) {
      throw new BadRequestException('No WP API key configured for this site.');
    }
    return site;
  }

  /** Generate/store the secret, push config to the plugin, enable auto-optimize. */
  async connect(siteId: string): Promise<OptimizationConfigPublic> {
    const site = await this.requireSite(siteId);
    const config = await this.configService.getOrCreate(siteId);
    const callbackUrl = this.callbackUrl(siteId);

    const secret = await this.configService.ensureWebhookSecret(config);
    await this.cdnPublishService.pushWebhookConfig(site, {
      callbackUrl,
      secret,
      enabled: true,
    });
    // Master plugin switch must be on for the hook to fire.
    await this.cdnPublishService.setPluginToggle(site, true);

    config.webhookEnabled = true;
    await this.configService.save(config);
    this.logger.log(`Auto-optimize webhook connected for site ${siteId}`);
    return this.configService.toPublic(config);
  }

  /** Disable auto-optimize (plugin stops firing). Secret is retained. */
  async disconnect(siteId: string): Promise<OptimizationConfigPublic> {
    const site = await this.requireSite(siteId);
    const config = await this.configService.getOrCreate(siteId);

    config.webhookEnabled = false;
    await this.configService.save(config);

    // Best-effort: tell the plugin to stop firing (does not touch rewrite state).
    try {
      await this.cdnPublishService.pushWebhookConfig(site, {
        callbackUrl: this.callbackUrl(siteId),
        secret: this.configService.getWebhookSecret(config) ?? '',
        enabled: false,
      });
    } catch (err) {
      this.logger.warn(
        `Webhook disconnect: plugin push failed (CMS side already off): ${(err as Error).message}`,
      );
    }
    this.logger.log(`Auto-optimize webhook disconnected for site ${siteId}`);
    return this.configService.toPublic(config);
  }
}
