import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Post, Query,
} from '@nestjs/common';
import { RedirectStatusService, RedirectListFilters } from './redirect-status.service';
import { RedirectSyncService } from './redirect-sync.service';
import {
  RedirectWriteService, RedirectCreateInput, RedirectUpdateInput,
} from './redirect-write.service';
import { RedirectValidateService, IntendedRedirect } from './redirect-validate.service';
import { RedirectResolveService } from './redirect-resolve.service';
import { RedirectAuditService } from './redirect-audit.service';
import { RedirectImportService, ImportMode } from './redirect-import.service';
import { RedirectExportService } from './redirect-export.service';
import { RedirectFormat } from './redirect-io';

/**
 * Redirect management — per-site mirror of the Redirection plugin.
 *  - Phase 1: read-only list/summary + "Sync now".
 *  - Phase 2: create/update/delete/enable-disable stage a PENDING change in the
 *    shared gate (they do NOT write to WP directly); the user approves via the
 *    existing /sites/:siteId/changes endpoints, which pushes to WP immediately.
 *    Plus a drift/conflict list + keep-WP / keep-CMS resolution.
 * Routes live under /api/sites/:siteId/redirects.
 */
@Controller('sites/:siteId/redirects')
export class RedirectController {
  constructor(
    private readonly status: RedirectStatusService,
    private readonly sync: RedirectSyncService,
    private readonly write: RedirectWriteService,
    private readonly validate: RedirectValidateService,
    private readonly resolve: RedirectResolveService,
    private readonly audit: RedirectAuditService,
    private readonly importSvc: RedirectImportService,
    private readonly exportSvc: RedirectExportService,
  ) {}

  /** Counts (live/disabled/tombstoned/regex + by code) + freshness + last run. */
  @Get('summary')
  getSummary(@Param('siteId') siteId: string) {
    return this.status.getSummary(siteId);
  }

  /** Paginated redirect list with filters (status / regex / code / search). */
  @Get()
  list(
    @Param('siteId') siteId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('status') status?: string,
    @Query('regex') regex?: string,
    @Query('actionCode') actionCode?: string,
    @Query('sort') sort?: string,
  ) {
    const filters: RedirectListFilters = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      search: search || undefined,
      status: status || undefined,
      regex: regex === 'true',
      actionCode: actionCode ? parseInt(actionCode, 10) : undefined,
      sort: sort || undefined,
    };
    return this.status.listRedirects(siteId, filters);
  }

  /** On-demand "Sync now" — mirror the plugin into the CMS immediately. */
  @Post('sync')
  syncNow(@Param('siteId') siteId: string) {
    return this.sync.syncNow(siteId);
  }

  // ── Bulk import / export (Phase 5) ──────────────────────────────────────────

  /** Dry-run: detect format → deterministic diff → per-row errors → backup id. */
  @Post('import/dry-run')
  @HttpCode(HttpStatus.OK)
  importDryRun(
    @Param('siteId') siteId: string,
    @Body() body: { content: string; format?: RedirectFormat; mode?: ImportMode; filename?: string },
  ) {
    return this.importSvc.dryRun(siteId, body.content ?? '', {
      format: body.format, mode: body.mode, filename: body.filename,
    });
  }

  /** Apply: auto-backup, then enqueue add/update/delete as gate change requests. */
  @Post('import/apply')
  @HttpCode(HttpStatus.OK)
  importApply(
    @Param('siteId') siteId: string,
    @Body() body: { content: string; format?: RedirectFormat; mode?: ImportMode; filename?: string; skipFingerprints?: string[] },
  ) {
    return this.importSvc.apply(siteId, body.content ?? '', {
      format: body.format, mode: body.mode, filename: body.filename, skipFingerprints: body.skipFingerprints,
    });
  }

  /** List auto-backups (for one-click restore). */
  @Get('import/backups')
  importBackups(@Param('siteId') siteId: string) {
    return this.importSvc.listBackups(siteId);
  }

  /** Restore a backup — re-enqueues its redirects through the gate (still approved). */
  @Post('import/backups/:backupId/restore')
  @HttpCode(HttpStatus.OK)
  importRestore(@Param('siteId') siteId: string, @Param('backupId') backupId: string) {
    return this.importSvc.restore(siteId, backupId);
  }

  /** Export: lossless (json/csv/apache/nginx) or the enriched auditor CSV. */
  @Get('export')
  export(
    @Param('siteId') siteId: string,
    @Query('mode') mode?: string,
    @Query('format') format?: RedirectFormat,
  ) {
    if (mode === 'audit') return this.exportSvc.auditCsv(siteId);
    return this.exportSvc.lossless(siteId, format ?? 'json');
  }

  // ── Audit (Phase 4) ─────────────────────────────────────────────────────────

  /** Run (or re-run) the first-sync audit: detect + enrich + rank + persist. */
  @Post('audit/run')
  @HttpCode(HttpStatus.OK)
  runAudit(@Param('siteId') siteId: string) {
    return this.audit.runAudit(siteId, 'manual');
  }

  /** Audit summary strip: counts by type/severity, batch vs judgment, last run. */
  @Get('audit/summary')
  auditSummary(@Param('siteId') siteId: string) {
    return this.audit.getSummary(siteId);
  }

  /** Paginated, rank-ordered issue list (filter by status/type/fixMode). */
  @Get('audit/issues')
  auditIssues(
    @Param('siteId') siteId: string,
    @Query('status') status?: string,
    @Query('type') type?: string,
    @Query('fixMode') fixMode?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.audit.listIssues(siteId, {
      status, type, fixMode,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  /** Grounded judgment suggestion (deterministic seam today; LLM later). */
  @Get('audit/issues/:issueId/suggest')
  auditSuggest(@Param('siteId') siteId: string, @Param('issueId') issueId: string) {
    return this.audit.suggestJudgment(siteId, issueId);
  }

  @Post('audit/issues/:issueId/defer')
  @HttpCode(HttpStatus.OK)
  auditDefer(@Param('siteId') siteId: string, @Param('issueId') issueId: string) {
    return this.audit.deferIssue(siteId, issueId);
  }

  @Post('audit/issues/:issueId/reopen')
  @HttpCode(HttpStatus.OK)
  auditReopen(@Param('siteId') siteId: string, @Param('issueId') issueId: string) {
    return this.audit.reopenIssue(siteId, issueId);
  }

  /** Batch mechanical fixes — each enqueues gate change requests (no bypass). */
  @Post('audit/batch/flatten')
  @HttpCode(HttpStatus.OK)
  batchFlatten(@Param('siteId') siteId: string) {
    return this.audit.batchFlatten(siteId);
  }

  @Post('audit/batch/disable-duplicates')
  @HttpCode(HttpStatus.OK)
  batchDisableDuplicates(@Param('siteId') siteId: string) {
    return this.audit.batchDisableDuplicates(siteId);
  }

  @Post('audit/batch/disable-dead')
  @HttpCode(HttpStatus.OK)
  batchDisableDead(@Param('siteId') siteId: string) {
    return this.audit.batchDisableDead(siteId);
  }

  // ── Validation engine (Phase 3) ─────────────────────────────────────────────

  /** Validate a prospective create/edit (duplicate/conflict warnings, cycle block). */
  @Post('validate')
  @HttpCode(HttpStatus.OK)
  validateNew(
    @Param('siteId') siteId: string,
    @Body() body: { intended: IntendedRedirect; excludeId?: string },
  ) {
    return this.validate.validateNew(siteId, body.intended, body.excludeId);
  }

  /** Static issue survey: duplicates, conflicts, cycles, and chain candidates. */
  @Get('issues')
  issues(@Param('siteId') siteId: string) {
    return this.validate.getIssues(siteId);
  }

  /** Live-resolve one redirect over HTTP (hop trail + final status), and cache it. */
  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  resolveLive(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.resolve.resolveRedirect(siteId, id);
  }

  /** Live flatten preview (A→B→C ⇒ A→final) with the safety verdict. */
  @Get(':id/flatten-preview')
  flattenPreview(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.validate.flattenPreview(siteId, id);
  }

  // ── Drift (WP-vs-CMS conflicts) ─────────────────────────────────────────────

  /** Redirects that changed in WP while a CMS edit was pending (adjudicate). */
  @Get('drift')
  drift(@Param('siteId') siteId: string) {
    return this.status.getDrift(siteId);
  }

  /** Resolve a conflict: keep-WP (reject CMS change) or keep-CMS (re-baseline). */
  @Post(':id/resolve-drift')
  @HttpCode(HttpStatus.OK)
  resolveDrift(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { resolution: 'keep_wp' | 'keep_cms' },
  ) {
    return this.write.resolveDrift(siteId, id, body.resolution);
  }

  // ── Writes — each STAGES a pending gate change (no direct WP write) ──────────

  /** Propose creating a new redirect (pending approval). */
  @Post('propose/create')
  @HttpCode(HttpStatus.CREATED)
  proposeCreate(@Param('siteId') siteId: string, @Body() body: RedirectCreateInput) {
    return this.write.proposeCreate(siteId, body);
  }

  /** Propose editing an existing redirect (pending approval). */
  @Post(':id/propose/update')
  @HttpCode(HttpStatus.CREATED)
  proposeUpdate(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: RedirectUpdateInput,
  ) {
    return this.write.proposeUpdate(siteId, id, body);
  }

  /** Propose enable/disable (pending approval). */
  @Post(':id/propose/toggle')
  @HttpCode(HttpStatus.CREATED)
  proposeToggle(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { enabled: boolean },
  ) {
    return this.write.proposeToggle(siteId, id, body.enabled);
  }

  /** Propose deleting a redirect (pending approval). */
  @Delete(':id/propose')
  @HttpCode(HttpStatus.CREATED)
  proposeDelete(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.write.proposeDelete(siteId, id);
  }

  @Get(':id')
  getOne(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.status.getRedirect(siteId, id);
  }

  @Get(':id/history')
  getHistory(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.status.getRedirectHistory(siteId, id);
  }
}
