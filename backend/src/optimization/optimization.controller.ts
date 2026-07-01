import {
  Controller,
  Get,
  Post,
  Put,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OptimizationService } from './optimization.service';
import { OptimizationConfigService } from './optimization-config.service';
import { OptimizationStatsService } from './optimization-stats.service';
import { UpdateOptimizationConfigDto } from './dto/update-optimization-config.dto';
import { RunOptimizationDto } from './dto/run-optimization.dto';

/**
 * Image-optimization endpoints (per site). Responses are wrapped in `{ data }`
 * by TransformInterceptor; the `/api` prefix is global.
 *
 * PHASE 1: local processing + stats only. No R2 / DNS / rewrite endpoints —
 * those are Phases 2-4.
 */
@Controller('sites/:siteId/optimization')
export class OptimizationController {
  constructor(
    private readonly optimizationService: OptimizationService,
    private readonly configService: OptimizationConfigService,
    private readonly statsService: OptimizationStatsService,
  ) {}

  /** Per-site settings (quality / webp / maxWidth / enabled). */
  @Get('config')
  getConfig(@Param('siteId') siteId: string) {
    return this.configService.getOrCreate(siteId);
  }

  @Put('config')
  updateConfig(
    @Param('siteId') siteId: string,
    @Body() dto: UpdateOptimizationConfigDto,
  ) {
    return this.configService.update(siteId, dto);
  }

  /** Honest optimization stats (current-state; single source of truth). */
  @Get('stats')
  stats(@Param('siteId') siteId: string) {
    return this.statsService.summary(siteId);
  }

  /** Paginated inventory with per-image optimization state. */
  @Get()
  list(
    @Param('siteId') siteId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '25',
    @Query('state') state = '',
    @Query('search') search = '',
  ) {
    return this.optimizationService.listImages(siteId, {
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 25,
      state: state || undefined,
      search: search || undefined,
    });
  }

  /** Start a background bulk run (scope: all | new_only | force_all). */
  @Post('run')
  @HttpCode(HttpStatus.OK)
  run(@Param('siteId') siteId: string, @Body() dto: RunOptimizationDto) {
    return this.optimizationService.startRun(siteId, dto.scope);
  }

  /** Poll a run's progress. */
  @Get('run/:runId')
  getRun(@Param('runId') runId: string) {
    return this.optimizationService.getRun(runId);
  }

  /** Request cancellation of a running bulk run. */
  @Post('run/:runId/cancel')
  @HttpCode(HttpStatus.OK)
  cancelRun(@Param('runId') runId: string) {
    return this.optimizationService.cancelRun(runId);
  }

  /** Recent run history. */
  @Get('runs')
  listRuns(@Param('siteId') siteId: string) {
    return this.optimizationService.listRuns(siteId);
  }

  /** Force re-optimize a single image. */
  @Post('images/:imageId/reoptimize')
  @HttpCode(HttpStatus.OK)
  reoptimize(
    @Param('siteId') siteId: string,
    @Param('imageId') imageId: string,
  ) {
    return this.optimizationService.reoptimizeOne(siteId, imageId);
  }
}
