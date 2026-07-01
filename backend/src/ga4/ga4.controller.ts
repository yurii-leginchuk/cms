import { Controller, Get, Param, Query } from '@nestjs/common';
import { Ga4Service } from './ga4.service';

/** Google Analytics 4 (organic) endpoints per site. */
@Controller('sites/:siteId/ga4')
export class Ga4Controller {
  constructor(private readonly ga4: Ga4Service) {}

  /** Is GA4 connected for this site, and which property matched the domain. */
  @Get('status')
  status(@Param('siteId') siteId: string) {
    return this.ga4.getSiteStatus(siteId);
  }

  /** Daily organic series: sessions / conversions / revenue / users. */
  @Get('series')
  series(
    @Param('siteId') siteId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.ga4.getSeries(siteId, from, to);
  }

  /** Range totals for the organic channel. */
  @Get('summary')
  summary(
    @Param('siteId') siteId: string,
    @Query('from') from: string,
    @Query('to') to: string,
  ) {
    return this.ga4.getSummary(siteId, from, to);
  }
}
