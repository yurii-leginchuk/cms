import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { GscModule } from '../gsc/gsc.module';
import { Site } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { CrawlPageStatus } from './crawl-page-status.entity';
import { CrawlInspection } from './crawl-inspection.entity';
import { CrawlScanRun } from './crawl-scan-run.entity';
import { CrawlQuotaLedger } from './crawl-quota-ledger.entity';
import { CrawlQuotaService } from './crawl-quota.service';
import { CrawlInspectService } from './crawl-inspect.service';
import { CrawlScanService } from './crawl-scan.service';
import { CrawlStatusService } from './crawl-status.service';
import { CrawlChangesService } from './crawl-changes.service';
import { CrawlController } from './crawl.controller';

/**
 * Google Index Inspection module. Nightly prioritized rotation + on-demand
 * re-inspection via the GSC URL Inspection API, an append-only change ledger,
 * an atomic quota ledger, and honest coverage/freshness reads. The `@Cron` lives
 * in CrawlScanService (ScheduleModule is global), so rollback is just removing
 * this module from AppModule + reverting the migration.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Site, Page, CrawlPageStatus, CrawlInspection, CrawlScanRun, CrawlQuotaLedger,
    ]),
    GscModule,
  ],
  controllers: [CrawlController],
  providers: [CrawlQuotaService, CrawlInspectService, CrawlScanService, CrawlStatusService, CrawlChangesService],
  exports: [CrawlScanService],
})
export class CrawlModule {}
