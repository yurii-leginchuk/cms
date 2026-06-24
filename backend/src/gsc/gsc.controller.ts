import { Controller, Get, Delete, Query, HttpCode } from '@nestjs/common';
import { GscService } from './gsc.service';

@Controller('gsc')
export class GscController {
  constructor(private readonly gscService: GscService) {}

  @Get('status')
  getStatus() {
    return this.gscService.getStatus();
  }

  @Get('site-status')
  getSiteStatus(@Query('siteUrl') siteUrl: string) {
    return this.gscService.getSiteStatus(siteUrl);
  }

  @Get('properties')
  listProperties() {
    return this.gscService.listProperties();
  }

  @Delete('cache')
  @HttpCode(204)
  clearCache(@Query('siteId') siteId?: string) {
    return this.gscService.clearCache(siteId);
  }
}
