import { Controller, Post, Get, Param, Query } from '@nestjs/common';
import { PageSpeedService, ScanMode } from './page-speed.service';
import { PsiStrategy } from './page-speed-result.entity';

@Controller('sites/:siteId/pagespeed')
export class PageSpeedController {
  constructor(private readonly svc: PageSpeedService) {}

  @Post('scan')
  triggerScan(
    @Param('siteId') siteId: string,
    @Query('strategy') strategy: PsiStrategy = 'mobile',
    @Query('mode') mode: ScanMode = 'all',
  ) {
    return this.svc.triggerScan(siteId, strategy, mode);
  }

  @Get('progress')
  getProgress(
    @Param('siteId') siteId: string,
    @Query('strategy') strategy: PsiStrategy = 'mobile',
  ) {
    return this.svc.getProgress(siteId, strategy);
  }

  @Get('stats')
  getStats(
    @Param('siteId') siteId: string,
    @Query('strategy') strategy: PsiStrategy = 'mobile',
  ) {
    return this.svc.getSiteStats(siteId, strategy);
  }

  @Get('results')
  getResults(
    @Param('siteId') siteId: string,
    @Query('strategy') strategy: PsiStrategy = 'mobile',
  ) {
    return this.svc.getSiteResults(siteId, strategy);
  }

  @Get('pages/:pageId/history')
  getPageHistory(
    @Param('pageId') pageId: string,
    @Query('strategy') strategy: PsiStrategy = 'mobile',
  ) {
    return this.svc.getPageResults(pageId, strategy);
  }

  @Get('pages/:pageId/analyze')
  analyzePage(
    @Param('siteId') siteId: string,
    @Param('pageId') pageId: string,
    @Query('strategy') strategy: PsiStrategy = 'mobile',
  ) {
    return this.svc.analyzePageLive(pageId, siteId, strategy);
  }
}
