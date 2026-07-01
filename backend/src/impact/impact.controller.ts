import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Query,
} from '@nestjs/common';
import { ChangeEventsService } from './change-events.service';
import {
  ImpactSeriesService, ImpactScope, BrandFilter,
} from './impact-series.service';
import { ImpactQueryService } from './impact-query.service';
import { WatchedKeywordsService, CreateWatchedKeyword } from './watched-keywords.service';
import { CannibalizationService } from './cannibalization.service';
import { ImpactAnnotationsService } from './impact-annotations.service';
import { gscMaxAvailable, addDays } from './gsc-date';

@Controller('sites/:siteId/impact')
export class ImpactController {
  constructor(
    private readonly events: ChangeEventsService,
    private readonly series: ImpactSeriesService,
    private readonly queries: ImpactQueryService,
    private readonly watched: WatchedKeywordsService,
    private readonly cannibalization: CannibalizationService,
    private readonly annotations: ImpactAnnotationsService,
  ) {}

  /** Unified change-event feed (meta / technical / schema). */
  @Get('events')
  listEvents(@Param('siteId') siteId: string, @Query('pageId') pageId?: string) {
    return this.events.listEvents(siteId, pageId || undefined);
  }

  /** Daily Search Console performance series for the timeline curve. */
  @Get('series')
  getSeries(
    @Param('siteId') siteId: string,
    @Query('scope') scope?: string,
    @Query('pageUrl') pageUrl?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('brand') brand?: string,
  ) {
    const max = gscMaxAvailable();
    return this.series.getSeries(siteId, {
      scope: scope === 'page' ? 'page' : ('global' as ImpactScope),
      pageUrl,
      from: from || addDays(max, -89),
      to: to || max,
      brand: brand === 'nonbranded' ? 'nonbranded' : ('all' as BrandFilter),
    });
  }

  /** Per-page top queries (current vs previous period) for the drill-down panel. */
  @Get('queries')
  getPageQueries(
    @Param('siteId') siteId: string,
    @Query('pageUrl') pageUrl: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('brand') brand?: string,
  ) {
    const max = gscMaxAvailable();
    return this.queries.getPageQueries(siteId, {
      pageUrl: pageUrl ?? '',
      from: from || addDays(max, -89),
      to: to || max,
      brand: brand === 'nonbranded' ? 'nonbranded' : ('all' as BrandFilter),
    });
  }

  /** Keyword cannibalization — site-wide, or scoped to one page via pageUrl. */
  @Get('cannibalization')
  getCannibalization(
    @Param('siteId') siteId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('pageUrl') pageUrl?: string,
    @Query('minImpressions') minImpressions?: string,
  ) {
    const max = gscMaxAvailable();
    return this.cannibalization.detect(siteId, {
      from: from || addDays(max, -89),
      to: to || max,
      pageUrl: pageUrl || undefined,
      minImpressions: minImpressions ? parseInt(minImpressions, 10) : undefined,
    });
  }

  // ── Watched keywords (monitoring) ──────────────────────────────────────────
  /** Watched keywords with current-vs-previous GSC metrics + trend points. */
  @Get('keywords/monitor')
  monitorKeywords(
    @Param('siteId') siteId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('pageId') pageId?: string,
  ) {
    const max = gscMaxAvailable();
    return this.watched.getMonitoring(siteId, {
      from: from || addDays(max, -89),
      to: to || max,
      pageId: pageId || undefined,
    });
  }

  @Get('keywords')
  listKeywords(@Param('siteId') siteId: string, @Query('pageId') pageId?: string) {
    return this.watched.list(siteId, pageId || undefined);
  }

  @Post('keywords')
  @HttpCode(HttpStatus.CREATED)
  addKeyword(@Param('siteId') siteId: string, @Body() body: CreateWatchedKeyword) {
    return this.watched.create(siteId, body);
  }

  @Delete('keywords/:id')
  removeKeyword(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.watched.remove(siteId, id);
  }

  // ── External-event annotations ─────────────────────────────────────────────
  @Get('annotations')
  listAnnotations(@Param('siteId') siteId: string) {
    return this.annotations.list(siteId);
  }

  @Post('annotations')
  @HttpCode(HttpStatus.CREATED)
  createAnnotation(
    @Param('siteId') siteId: string,
    @Body() body: { date: string; label: string; pageId?: string | null; type?: string | null; link?: string | null },
  ) {
    return this.annotations.create(siteId, body);
  }

  @Patch('annotations/:id')
  updateAnnotation(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() body: { date?: string; label?: string; pageId?: string | null; type?: string | null; link?: string | null },
  ) {
    return this.annotations.update(siteId, id, body);
  }

  @Delete('annotations/:id')
  removeAnnotation(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.annotations.remove(siteId, id);
  }
}
