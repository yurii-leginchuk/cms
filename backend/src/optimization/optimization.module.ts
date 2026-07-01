import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BullModule } from '@nestjs/bullmq';
import { Site } from '../sites/site.entity';
import { SiteImage } from '../images/site-image.entity';
import { ImageModule } from '../images/image.module';
import { CryptoModule } from '../common/crypto/crypto.module';
import { ImageOptimization } from './image-optimization.entity';
import { ImageOptimizationRun } from './image-optimization-run.entity';
import { SiteOptimizationConfig } from './site-optimization-config.entity';
import { ImageProcessingService } from './image-processing.service';
import { OptimizationConfigService } from './optimization-config.service';
import { OptimizationStatsService } from './optimization-stats.service';
import { OptimizationService } from './optimization.service';
import { R2Service } from './r2.service';
import { CloudflareR2AdminService } from './cloudflare-r2-admin.service';
import { R2SetupService } from './r2-setup.service';
import { CloudflareCdnService } from './cloudflare-cdn.service';
import { CdnPublishService } from './cdn-publish.service';
import { CdnSetupService } from './cdn-setup.service';
import { OptimizationAutopilotService } from './optimization-autopilot.service';
import { OptimizationProcessor, OPTIMIZE_QUEUE } from './optimization.processor';
import { WebhookService } from './webhook.service';
import { WebhookSetupService } from './webhook-setup.service';
import { OptimizationController } from './optimization.controller';
import { WebhookController } from './webhook.controller';

/**
 * Image Optimization.
 *   Phase 1: local encode + stats (extends the SiteImage inventory).
 *   Phase 2 (this): encrypted per-site R2 credentials, auto-create bucket via
 *     Cloudflare, real test-connection, and upload optimized artifacts to R2.
 * No live-site changes / URL rewriting yet (Phase 3).
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Site,
      SiteImage,
      ImageOptimization,
      ImageOptimizationRun,
      SiteOptimizationConfig,
    ]),
    ImageModule,
    CryptoModule,
    BullModule.registerQueue({ name: OPTIMIZE_QUEUE }),
  ],
  controllers: [OptimizationController, WebhookController],
  providers: [
    ImageProcessingService,
    OptimizationConfigService,
    OptimizationStatsService,
    OptimizationService,
    R2Service,
    CloudflareR2AdminService,
    R2SetupService,
    CloudflareCdnService,
    CdnPublishService,
    CdnSetupService,
    OptimizationAutopilotService,
    OptimizationProcessor,
    WebhookService,
    WebhookSetupService,
  ],
  exports: [
    OptimizationService,
    OptimizationConfigService,
    OptimizationAutopilotService,
    CloudflareCdnService,
  ],
})
export class OptimizationModule {}
