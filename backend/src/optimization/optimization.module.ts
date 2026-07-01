import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from '../sites/site.entity';
import { SiteImage } from '../images/site-image.entity';
import { ImageModule } from '../images/image.module';
import { ImageOptimization } from './image-optimization.entity';
import { ImageOptimizationRun } from './image-optimization-run.entity';
import { SiteOptimizationConfig } from './site-optimization-config.entity';
import { ImageProcessingService } from './image-processing.service';
import { OptimizationConfigService } from './optimization-config.service';
import { OptimizationStatsService } from './optimization-stats.service';
import { OptimizationService } from './optimization.service';
import { OptimizationController } from './optimization.controller';

/**
 * Image Optimization (Phase 1) — extends the existing image inventory
 * (`SiteImage`) with a 1:1 optimization state companion, a per-site config, and
 * append-only run history. Reuses `WpMediaService` (exported by ImageModule) to
 * refresh the inventory. No external infra yet (R2/DNS/rewrite = Phases 2-4).
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
  ],
  controllers: [OptimizationController],
  providers: [
    ImageProcessingService,
    OptimizationConfigService,
    OptimizationStatsService,
    OptimizationService,
  ],
  exports: [OptimizationService, OptimizationConfigService],
})
export class OptimizationModule {}
