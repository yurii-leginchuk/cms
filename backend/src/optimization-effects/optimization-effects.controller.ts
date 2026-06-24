import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { OptimizationEffectsService } from './optimization-effects.service';

@Controller('sites/:siteId/optimization-effects')
export class OptimizationEffectsController {
  constructor(private readonly service: OptimizationEffectsService) {}

  @Get()
  findBySite(
    @Param('siteId') siteId: string,
    @Query('pageId') pageId?: string,
  ) {
    return this.service.findBySite(siteId, pageId);
  }

  /** Per-query before→after drill-down for one effect (lazy-loaded on expand). */
  @Get(':id/queries')
  getQueries(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.service.getEffectQueries(siteId, id);
  }

  @Post(':id/measure')
  @HttpCode(HttpStatus.OK)
  measureNow(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.service.measureById(siteId, id);
  }
}
