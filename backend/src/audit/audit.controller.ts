import {
  Body, Controller, Get, Param, Patch, Post, Query,
} from '@nestjs/common';
import { AuditStatusService, FindingListFilters } from './audit-status.service';
import { AuditRunService } from './audit-run.service';
import { MuteFindingDto, AcceptFindingDto } from './dto/mute-finding.dto';
import { PatchAuditSettingsDto } from './dto/patch-settings.dto';

/**
 * Technical SEO Site Audit — Phase 1 surface (run engine + P0 regression
 * detectors + honest diff). Routes live under /api/sites/:siteId/audit.
 * Read-and-report only: no WordPress writes, no AI, no Asana in this phase.
 */
@Controller('sites/:siteId/audit')
export class AuditController {
  constructor(
    private readonly status: AuditStatusService,
    private readonly runService: AuditRunService,
  ) {}

  /** Trust strip + diff digest + coverage + severity counts + catalog. */
  @Get('summary')
  getSummary(@Param('siteId') siteId: string) {
    return this.status.getSummary(siteId);
  }

  /** Grouped findings (one issue = one row) with diff-state annotation. */
  @Get('findings')
  listFindings(
    @Param('siteId') siteId: string,
    @Query('severity') severity?: string,
    @Query('checkType') checkType?: string,
    @Query('status') status?: string,
    @Query('diff') diff?: string,
    @Query('showMuted') showMuted?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const filters: FindingListFilters = {
      severity: severity || undefined,
      checkType: checkType || undefined,
      status: status || undefined,
      diff: diff || undefined,
      showMuted: showMuted === 'true',
      search: search || undefined,
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
    };
    return this.status.listFindings(siteId, filters);
  }

  /** Finding detail: evidence envelope + affected URLs + observation history. */
  @Get('findings/:id')
  getFinding(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.status.getFinding(siteId, id);
  }

  /** Mute (reason required) — persists by fingerprint, resurfaces on worsening. */
  @Post('findings/:id/mute')
  mute(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: MuteFindingDto,
  ) {
    return this.status.mute(siteId, id, body.reason, null);
  }

  @Post('findings/:id/unmute')
  unmute(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.status.unmute(siteId, id);
  }

  /** Accept-as-intended: stays visible, stops alarming. */
  @Post('findings/:id/accept')
  accept(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: AcceptFindingDto,
  ) {
    return this.status.accept(siteId, id, body.reason ?? null);
  }

  /** Manual run (1/hour cooldown, shares the live-fetch budget). */
  @Post('run')
  runNow(@Param('siteId') siteId: string) {
    return this.runService.startManualRun(siteId);
  }

  @Get('settings')
  getSettings(@Param('siteId') siteId: string) {
    return this.status.getSettings(siteId);
  }

  @Patch('settings')
  patchSettings(@Param('siteId') siteId: string, @Body() body: PatchAuditSettingsDto) {
    return this.status.patchSettings(siteId, body);
  }
}
