import {
  Body, Controller, Get, Param, Post, Query,
} from '@nestjs/common';
import { CrawlStatusService, CrawlListFilters } from './crawl-status.service';
import { CrawlScanService } from './crawl-scan.service';
import { CrawlChangesService } from './crawl-changes.service';
import { InspectPagesDto } from './dto/inspect-pages.dto';

/**
 * Index Inspection — per-site index-status surface backed by the GSC URL
 * Inspection API. Routes live under /api/sites/:siteId/index-status.
 */
@Controller('sites/:siteId/index-status')
export class CrawlController {
  constructor(
    private readonly status: CrawlStatusService,
    private readonly scan: CrawlScanService,
    private readonly changes: CrawlChangesService,
  ) {}

  /** Coverage-with-denominators + freshness + quota + last run. */
  @Get('summary')
  getSummary(@Param('siteId') siteId: string) {
    return this.status.getSummary(siteId);
  }

  /** Paginated page list with filters (segment / freshness / conflict / search). */
  @Get('pages')
  listPages(
    @Param('siteId') siteId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('segment') segment?: string,
    @Query('freshness') freshness?: string,
    @Query('canonicalConflict') canonicalConflict?: string,
    @Query('sort') sort?: string,
  ) {
    const filters: CrawlListFilters = {
      page: page ? parseInt(page, 10) : 1,
      limit: limit ? parseInt(limit, 10) : 50,
      search: search || undefined,
      segment: segment || undefined,
      freshness: freshness || undefined,
      canonicalConflict: canonicalConflict === 'true',
      sort: sort || undefined,
    };
    return this.status.listPages(siteId, filters);
  }

  @Get('quota')
  getQuota(@Param('siteId') siteId: string) {
    return this.status.getQuota(siteId);
  }

  @Get('pages/:pageId')
  getPage(@Param('siteId') siteId: string, @Param('pageId') pageId: string) {
    return this.status.getPageDetail(siteId, pageId);
  }

  @Get('pages/:pageId/history')
  getHistory(@Param('siteId') siteId: string, @Param('pageId') pageId: string) {
    return this.status.getPageHistory(siteId, pageId);
  }

  /** On-demand re-inspection of specific pages (uses daily-cap headroom). */
  @Post('inspect')
  inspect(@Param('siteId') siteId: string, @Body() body: InspectPagesDto) {
    return this.scan.inspectPagesOnDemand(siteId, body.pageIds);
  }

  // ── Change analyzer (what happened after a scan) ──────────────────────────

  /** Digest of the most recent scan run — for the "after scan" report + Overview. */
  @Get('changes/latest')
  latestDigest(@Param('siteId') siteId: string) {
    return this.changes.latestDigest(siteId);
  }

  /** Recent-changes feed across runs (newest first). */
  @Get('changes')
  recentChanges(
    @Param('siteId') siteId: string,
    @Query('limit') limit?: string,
    @Query('days') days?: string,
    @Query('deindexOnly') deindexOnly?: string,
  ) {
    return this.changes.recentChanges(siteId, {
      limit: limit ? parseInt(limit, 10) : undefined,
      days: days ? parseInt(days, 10) : undefined,
      deindexOnly: deindexOnly === 'true',
    });
  }

  // ── Sitemap discovery nudge (#2) + loop (#3 = re-inspect above) ────────────

  @Get('sitemap')
  getSitemap(@Param('siteId') siteId: string) {
    return this.status.getSitemapInfo(siteId);
  }

  @Post('sitemap/resubmit')
  resubmitSitemap(@Param('siteId') siteId: string) {
    return this.status.resubmitSitemap(siteId);
  }
}
