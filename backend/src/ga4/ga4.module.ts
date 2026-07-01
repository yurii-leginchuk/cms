import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from '../sites/site.entity';
import { Ga4Service } from './ga4.service';
import { Ga4Controller } from './ga4.controller';

/**
 * Google Analytics 4 — organic sessions/conversions/revenue per site, using the
 * same service account as GSC. Finds the property by matching the site's domain
 * to a web data-stream (GA4 Admin API), then reads via the Analytics Data API.
 */
@Module({
  imports: [TypeOrmModule.forFeature([Site])],
  controllers: [Ga4Controller],
  providers: [Ga4Service],
  exports: [Ga4Service],
})
export class Ga4Module {}
