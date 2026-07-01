import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SiteImage } from '../images/site-image.entity';
import { ImageOptimization } from './image-optimization.entity';
import { ImageProcessingService } from './image-processing.service';
import { OptimizationConfigService } from './optimization-config.service';
import { computeSettingsFingerprint } from './optimization-fingerprint';
import { aggregateStats, OptimizationStatsSummary } from './optimization-stats';

/**
 * Reads current-state rows + inventory count and delegates the math to the pure
 * `aggregateStats`. This service is the ONLY place the app computes optimization
 * savings (analyst: single source of truth), so the tab, the run summary, and
 * later the MCP tools can never disagree.
 */
@Injectable()
export class OptimizationStatsService {
  constructor(
    @InjectRepository(SiteImage)
    private readonly imageRepo: Repository<SiteImage>,
    @InjectRepository(ImageOptimization)
    private readonly optRepo: Repository<ImageOptimization>,
    private readonly processing: ImageProcessingService,
    private readonly configService: OptimizationConfigService,
  ) {}

  async summary(siteId: string): Promise<OptimizationStatsSummary> {
    const config = await this.configService.getOrCreate(siteId);
    const fingerprint = computeSettingsFingerprint({
      quality: config.quality,
      webpEnabled: config.webpEnabled,
      maxWidth: config.maxWidth,
      encoderVersion: this.processing.encoderVersion(),
    });

    const [rows, inventoryTotal] = await Promise.all([
      this.optRepo.find({
        where: { siteId },
        select: [
          'state',
          'originalBytes',
          'optimizedBytes',
          'settingsFingerprint',
          'optimizedAt',
          'rewriteLive',
        ],
      }),
      this.imageRepo.count({ where: { siteId } }),
    ]);

    return aggregateStats(rows, fingerprint, inventoryTotal);
  }
}
