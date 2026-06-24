import { Controller, Post, Get, Param } from '@nestjs/common';
import { CruxService } from './crux.service';

@Controller('sites/:siteId/crux')
export class CruxController {
  constructor(private readonly svc: CruxService) {}

  @Post('fetch')
  triggerFetch(@Param('siteId') siteId: string) {
    return this.svc.triggerFetch(siteId);
  }

  @Get('progress')
  getProgress(@Param('siteId') siteId: string) {
    return this.svc.getProgress(siteId);
  }

  @Get('results')
  getResults(@Param('siteId') siteId: string) {
    return this.svc.getSiteResults(siteId);
  }

  @Get('stats')
  getStats(@Param('siteId') siteId: string) {
    return this.svc.getSiteStats(siteId);
  }
}
