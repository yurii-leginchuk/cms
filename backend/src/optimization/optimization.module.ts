import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
import { OptimizationController } from './optimization.controller';

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
  ],
  controllers: [OptimizationController],
  providers: [
    ImageProcessingService,
    OptimizationConfigService,
    OptimizationStatsService,
    OptimizationService,
    R2Service,
    CloudflareR2AdminService,
    R2SetupService,
  ],
  exports: [OptimizationService, OptimizationConfigService],
})
export class OptimizationModule {}
