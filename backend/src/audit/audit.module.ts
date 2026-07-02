import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { CrawlPageStatus } from '../crawl/crawl-page-status.entity';
import { GscDaily } from '../impact/gsc-daily.entity';
import { AuditRun } from './audit-run.entity';
import { AuditFinding } from './audit-finding.entity';
import { AuditObservation } from './audit-observation.entity';
import { AuditSiteSettings } from './audit-site-settings.entity';
import { AuditSourceService } from './audit-source.service';
import { AuditFetchService } from './audit-fetch.service';
import { AuditRunService } from './audit-run.service';
import { AuditStatusService } from './audit-status.service';
import { AuditController } from './audit.controller';

/**
 * Technical SEO Site Audit — a weekly regression-diff engine, NOT a new
 * crawler: it reads the data the CMS already trusts (nightly-parsed pages,
 * crawl/redirect ledgers, GSC cache) plus a small bounded live-fetch set
 * (robots.txt diff, sitemap, HTTPS/cert, 404-probe, suspect re-verification),
 * and pages a human only on CHANGE.
 *
 * The Monday-05:00-ET `@Cron` lives in AuditRunService (ScheduleModule is
 * global). Rollback = remove this module from AppModule + revert the
 * migration; all reads, zero impact on other modules.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Site, Page, CrawlPageStatus, GscDaily,
      AuditRun, AuditFinding, AuditObservation, AuditSiteSettings,
    ]),
  ],
  controllers: [AuditController],
  providers: [AuditSourceService, AuditFetchService, AuditRunService, AuditStatusService],
  exports: [AuditRunService],
})
export class AuditModule {}
