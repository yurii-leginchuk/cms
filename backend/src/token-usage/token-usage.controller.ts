import { Controller, Get, Query } from '@nestjs/common';
import { TokenUsageService } from './token-usage.service';

@Controller('token-usage')
export class TokenUsageController {
  constructor(private readonly service: TokenUsageService) {}

  @Get('stats')
  async getStats(
    @Query('days') days?: string,
    @Query('siteId') siteId?: string,
  ) {
    return this.service.getStats({
      days: days ? parseInt(days, 10) : undefined,
      siteId,
    });
  }
}
