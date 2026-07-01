import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { OptimizationService } from './optimization.service';
import { OptimizationConfigService } from './optimization-config.service';
import { CdnPublishService } from './cdn-publish.service';
import {
  SiteOptimizationConfig,
  R2Status,
} from './site-optimization-config.entity';
import {
  OptimizationRunScope,
  OptimizationRunTrigger,
} from './image-optimization-run.entity';

export interface AutopilotResult {
  siteId: string;
  skipped?: string;
  optimized?: number;
  skippedImages?: number;
  failed?: number;
  published?: number;
}

/**
 * Nightly image-optimization autopilot. Mirrors ImageAutopilotService.
 *
 * STRICTLY new_only: it ingests to discover NEW attachments and optimizes only
 * not_optimized / stale rows — it NEVER re-touches an already-optimized image
 * (idempotency by sourceHash + settingsFingerprint). A second run with no new
 * images does zero optimization work (it CONVERGES). Re-optimization is only ever
 * the explicit user force action.
 */
@Injectable()
export class OptimizationAutopilotService {
  private readonly logger = new Logger(OptimizationAutopilotService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(SiteOptimizationConfig)
    private readonly configRepo: Repository<SiteOptimizationConfig>,
    private readonly optimizationService: OptimizationService,
    private readonly configService: OptimizationConfigService,
    private readonly cdnPublishService: CdnPublishService,
  ) {}

  async runForSite(
    siteId: string,
    trigger: OptimizationRunTrigger = OptimizationRunTrigger.MANUAL,
  ): Promise<AutopilotResult> {
    const config = await this.configService.getOrCreate(siteId);
    if (!config.enabled) return { siteId, skipped: 'disabled' };
    if (config.r2Status !== R2Status.VERIFIED) return { siteId, skipped: 'r2_not_verified' };

    // NEW_ONLY — the non-negotiable rule: never re-touch optimized images.
    const run = await this.optimizationService.runBlocking(
      siteId,
      OptimizationRunScope.NEW_ONLY,
      trigger,
    );

    let published = 0;
    if (config.rewriteEnabled) {
      const site = await this.siteRepo.findOne({ where: { id: siteId } });
      if (site) {
        try {
          const res = await this.cdnPublishService.publish(config, site);
          published = res.verified;
        } catch (err) {
          this.logger.warn(
            `Autopilot publish failed for site ${siteId}: ${(err as Error).message}`,
          );
        }
      }
    }

    const result: AutopilotResult = {
      siteId,
      optimized: run.optimized,
      skippedImages: run.skipped,
      failed: run.failed,
      published,
    };
    this.logger.log(
      `Optimize autopilot site ${siteId}: +${run.optimized} optimized, ` +
        `${run.skipped} skipped, ${run.failed} failed, ${published} published`,
    );
    return result;
  }

  /** Manual trigger for one site (endpoint). */
  async runManual(siteId: string): Promise<AutopilotResult> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    return this.runForSite(siteId, OptimizationRunTrigger.MANUAL);
  }

  /** Nightly: every site with autopilot enabled + R2 verified. Resilient per-site. */
  async runForAllSites(): Promise<void> {
    const configs = await this.configRepo.find({
      where: { enabled: true, autopilotEnabled: true, r2Status: R2Status.VERIFIED },
      select: ['siteId'],
    });
    for (const c of configs) {
      try {
        await this.runForSite(c.siteId, OptimizationRunTrigger.NIGHTLY);
      } catch (err) {
        this.logger.warn(
          `Optimize autopilot failed for site ${c.siteId}: ${(err as Error).message}`,
        );
      }
    }
  }
}
