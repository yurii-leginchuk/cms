import { Controller, Get, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { SyncService } from './sync.service';

@Controller('sites/:siteId/sync')
export class SyncController {
  constructor(private readonly syncService: SyncService) {}

  /** Trigger push to WordPress — returns 202 immediately, processes in background */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  triggerSync(@Param('siteId') siteId: string) {
    this.syncService.triggerSiteSync(siteId);
    return { message: 'Sync initiated' };
  }

  /** Push a SINGLE page now (per-page Apply on the meta editor). */
  @Post('page/:pageId')
  @HttpCode(HttpStatus.ACCEPTED)
  triggerPageSync(
    @Param('siteId') siteId: string,
    @Param('pageId') pageId: string,
  ) {
    this.syncService.triggerPageSync(siteId, pageId);
    return { message: 'Sync initiated' };
  }

  /** Aggregate counts of pages by syncStatus */
  @Get('status')
  getStatus(@Param('siteId') siteId: string) {
    return this.syncService.getSiteStatus(siteId);
  }
}
