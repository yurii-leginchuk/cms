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
import { R2SetupService } from './r2-setup.service';
import { CdnSetupService } from './cdn-setup.service';
import { OptimizationAutopilotService } from './optimization-autopilot.service';
import { WebhookSetupService } from './webhook-setup.service';
import { UpdateOptimizationConfigDto } from './dto/update-optimization-config.dto';
import { RunOptimizationDto } from './dto/run-optimization.dto';
import { UpdateR2ConfigDto } from './dto/update-r2-config.dto';
import { CreateBucketDto } from './dto/create-bucket.dto';
import { ProvisionCdnDto } from './dto/provision-cdn.dto';

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
    private readonly r2SetupService: R2SetupService,
    private readonly cdnSetupService: CdnSetupService,
    private readonly autopilotService: OptimizationAutopilotService,
    private readonly webhookSetupService: WebhookSetupService,
  ) {}

  /** Per-site settings (redacted — secrets exposed only as isSet booleans). */
  @Get('config')
  getConfig(@Param('siteId') siteId: string) {
    return this.configService.getPublic(siteId);
  }

  @Put('config')
  updateConfig(
    @Param('siteId') siteId: string,
    @Body() dto: UpdateOptimizationConfigDto,
  ) {
    return this.configService.update(siteId, dto);
  }

  // ── R2 setup (Phase 2) ──────────────────────────────────────────────────────

  /** Write R2/Cloudflare credentials (secrets write-only; response redacts them). */
  @Put('config/r2')
  updateR2Config(
    @Param('siteId') siteId: string,
    @Body() dto: UpdateR2ConfigDto,
  ) {
    return this.configService.updateR2(siteId, dto);
  }

  /** Auto-create (or reuse) the site's R2 bucket via Cloudflare. */
  @Post('config/r2/create-bucket')
  @HttpCode(HttpStatus.OK)
  createBucket(
    @Param('siteId') siteId: string,
    @Body() dto: CreateBucketDto,
  ) {
    return this.r2SetupService.createBucket(siteId, dto.name);
  }

  /** Real write→head→delete round-trip → sets r2Status verified/failed (+reason). */
  @Post('config/r2/test')
  @HttpCode(HttpStatus.OK)
  testR2(@Param('siteId') siteId: string) {
    return this.r2SetupService.testConnection(siteId);
  }

  // ── CDN custom domain + live rewrite (Phase 3) ──────────────────────────────

  /** Bind the CDN custom domain (gated: requires R2 verified). */
  @Post('config/cdn/provision')
  @HttpCode(HttpStatus.OK)
  provisionCdn(
    @Param('siteId') siteId: string,
    @Body() dto: ProvisionCdnDto,
  ) {
    return this.cdnSetupService.provision(siteId, dto);
  }

  /** Poll the custom-domain provisioning status (pending → active / error). */
  @Get('config/cdn/status')
  cdnStatus(@Param('siteId') siteId: string) {
    return this.cdnSetupService.refreshStatus(siteId);
  }

  /** Enable live rewriting. 409 unless R2 verified AND DNS active (gate #1). */
  @Post('config/rewrite/enable')
  @HttpCode(HttpStatus.OK)
  enableRewrite(@Param('siteId') siteId: string) {
    return this.cdnSetupService.enableRewrite(siteId);
  }

  /** Kill-switch: stop rewriting everywhere (deletes nothing). */
  @Post('config/rewrite/disable')
  @HttpCode(HttpStatus.OK)
  disableRewrite(@Param('siteId') siteId: string) {
    return this.cdnSetupService.disableRewrite(siteId);
  }

  // ── Automation (Phase 4) ────────────────────────────────────────────────────

  /** Connect auto-optimize-on-upload: generate secret + push webhook config to plugin. */
  @Post('config/webhook/connect')
  @HttpCode(HttpStatus.OK)
  connectWebhook(@Param('siteId') siteId: string) {
    return this.webhookSetupService.connect(siteId);
  }

  /** Disconnect auto-optimize-on-upload. */
  @Post('config/webhook/disconnect')
  @HttpCode(HttpStatus.OK)
  disconnectWebhook(@Param('siteId') siteId: string) {
    return this.webhookSetupService.disconnect(siteId);
  }

  /** Manually run the optimize autopilot now (new_only). */
  @Post('autopilot')
  @HttpCode(HttpStatus.OK)
  autopilot(@Param('siteId') siteId: string) {
    return this.autopilotService.runManual(siteId);
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
