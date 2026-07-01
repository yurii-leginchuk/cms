import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import axios from 'axios';
import { Site } from '../sites/site.entity';
import { SiteImage } from '../images/site-image.entity';
import { ImageOptimization } from './image-optimization.entity';
import { SiteOptimizationConfig } from './site-optimization-config.entity';
import { buildCdnUrl, buildPublishCandidates } from './cdn-helpers';

export interface PublishResult {
  eligible: number;
  verified: number;
  published: number;
  failedHead: number;
}

/**
 * Publishes VERIFIED CDN mappings to the WordPress plugin — the enforcement of
 * safety gate #2. For each image that is uploaded to R2, the CMS builds the CDN
 * URL, HEAD-checks it returns 200, and only then marks it rewriteLive and
 * includes it in the batch pushed to the plugin. Rows that don't pass are left
 * rewriteLive=false, so the plugin never rewrites them → they keep serving the
 * original WordPress URL.
 *
 * Reuses the image-sync push pattern (X-Poirier-API-Key over the plugin REST).
 */
@Injectable()
export class CdnPublishService {
  private readonly logger = new Logger(CdnPublishService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteImage) private readonly imageRepo: Repository<SiteImage>,
    @InjectRepository(ImageOptimization)
    private readonly optRepo: Repository<ImageOptimization>,
  ) {}

  /** HEAD-check a URL returns a 2xx. Never throws (a failure = not verified). */
  async headOk(url: string): Promise<boolean> {
    try {
      const res = await axios.head(url, {
        timeout: 10_000,
        validateStatus: () => true,
      });
      return res.status >= 200 && res.status < 300;
    } catch {
      return false;
    }
  }

  /**
   * Verify + publish the CDN map for a site. Requires a cdnDomain. Marks
   * rewriteLive on HEAD-200 rows and pushes the verified batch to the plugin.
   */
  async publish(
    config: SiteOptimizationConfig,
    site: Site,
  ): Promise<PublishResult> {
    if (!config.cdnDomain) {
      throw new BadRequestException('No CDN domain configured.');
    }
    if (!site.wpApiKey) {
      throw new BadRequestException('No WP API key configured for this site.');
    }

    const rows = await this.optRepo.find({
      where: { siteId: config.siteId, r2Uploaded: true },
    });
    const images = rows.length
      ? await this.imageRepo.find({
          where: { id: In(rows.map((r) => r.imageId)) },
          select: ['id', 'wpAttachmentId'],
        })
      : [];
    const attById = new Map(images.map((i) => [i.id, i.wpAttachmentId]));

    const candidates = buildPublishCandidates(rows, attById);
    const rowById = new Map(rows.map((r) => [r.imageId, r]));

    const mappings: { wpAttachmentId: number; cdnUrl: string }[] = [];
    const removals: number[] = [];
    let failedHead = 0;
    const now = new Date();

    for (const c of candidates) {
      const cdnUrl = buildCdnUrl(config.cdnDomain, c.r2Key);
      const ok = await this.headOk(cdnUrl);
      const row = rowById.get(c.imageId)!;
      if (ok) {
        row.rewriteLive = true;
        row.rewriteVerifiedAt = now;
        mappings.push({ wpAttachmentId: c.wpAttachmentId, cdnUrl });
      } else {
        // Lost verification → also REVOKE the mapping in the plugin, otherwise
        // WP keeps rewriting this attachment to a dead CDN URL (the plugin map
        // is upsert-only and nothing else removes entries).
        if (row.rewriteLive) removals.push(c.wpAttachmentId);
        row.rewriteLive = false;
        failedHead++;
      }
      await this.optRepo.save(row);
    }

    if (mappings.length || removals.length) {
      await this.pushMap(site, mappings, removals);
    }

    this.logger.log(
      `CDN publish site ${config.siteId}: ${candidates.length} eligible, ` +
        `${mappings.length} verified+published, ${failedHead} failed HEAD`,
    );
    return {
      eligible: candidates.length,
      verified: mappings.length,
      published: mappings.length,
      failedHead,
    };
  }

  /** Push the verified {wpAttachmentId -> cdnUrl} batch (+ revocations) to the plugin. */
  async pushMap(
    site: Site,
    mappings: { wpAttachmentId: number; cdnUrl: string }[],
    remove: number[] = [],
  ): Promise<void> {
    try {
      await axios.post(
        `${site.url}/wp-json/poirier-cms/v1/cdn-map`,
        { mappings, ...(remove.length ? { remove } : {}) },
        {
          timeout: 15_000,
          headers: {
            'Content-Type': 'application/json',
            'X-Poirier-API-Key': site.wpApiKey as string,
          },
        },
      );
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'no response'}`
        : (err as Error).message;
      throw new ServiceUnavailableException(`CDN map publish failed: ${msg}`);
    }
  }

  /**
   * Publish a SINGLE verified mapping (used by the new-upload webhook path so a
   * burst of uploads doesn't re-HEAD the whole library). HEAD-checks the CDN URL,
   * marks rewriteLive, and pushes just that one mapping.
   */
  async publishOne(
    config: SiteOptimizationConfig,
    site: Site,
    row: ImageOptimization,
    wpAttachmentId: number,
  ): Promise<boolean> {
    if (!config.cdnDomain || !row.r2Key || !row.r2Uploaded) return false;
    const cdnUrl = buildCdnUrl(config.cdnDomain, row.r2Key);
    const ok = await this.headOk(cdnUrl);
    if (!ok) {
      const wasLive = row.rewriteLive;
      row.rewriteLive = false;
      await this.optRepo.save(row);
      // Revoke a previously-live mapping so WP falls back to the original URL.
      if (wasLive) {
        try {
          await this.pushMap(site, [], [wpAttachmentId]);
        } catch (err) {
          this.logger.warn(`CDN map revoke failed: ${(err as Error).message}`);
        }
      }
      return false;
    }
    row.rewriteLive = true;
    row.rewriteVerifiedAt = new Date();
    await this.optRepo.save(row);
    await this.pushMap(site, [{ wpAttachmentId, cdnUrl }]);
    return true;
  }

  /** Push the plugin→CMS webhook config (callback URL + secret + enabled flag). */
  async pushWebhookConfig(
    site: Site,
    body: { callbackUrl: string; secret: string; enabled: boolean },
  ): Promise<void> {
    if (!site.wpApiKey) throw new BadRequestException('No WP API key configured.');
    try {
      await axios.post(`${site.url}/wp-json/poirier-cms/v1/webhook-config`, body, {
        timeout: 15_000,
        headers: {
          'Content-Type': 'application/json',
          'X-Poirier-API-Key': site.wpApiKey,
        },
      });
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'no response'}`
        : (err as Error).message;
      throw new ServiceUnavailableException(`Webhook config push failed: ${msg}`);
    }
  }

  /** Flip the plugin kill-switch (deletes nothing). */
  async setPluginToggle(site: Site, enabled: boolean): Promise<void> {
    if (!site.wpApiKey) throw new BadRequestException('No WP API key configured.');
    try {
      await axios.post(
        `${site.url}/wp-json/poirier-cms/v1/optimize-toggle`,
        { enabled },
        {
          timeout: 15_000,
          headers: {
            'Content-Type': 'application/json',
            'X-Poirier-API-Key': site.wpApiKey,
          },
        },
      );
    } catch (err) {
      const msg = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'no response'}`
        : (err as Error).message;
      throw new ServiceUnavailableException(`Plugin toggle failed: ${msg}`);
    }
  }

  async requireSite(siteId: string): Promise<Site> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }
}
