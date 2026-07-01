import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Site } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { GscDaily } from '../impact/gsc-daily.entity';
import { CrawlPageStatus } from '../crawl/crawl-page-status.entity';
import { McpChangeRequest } from '../mcp-changes/mcp-change-request.entity';
import { Ga4Module } from '../ga4/ga4.module';
import { RedirectItem } from './redirect-item.entity';
import { RedirectSnapshot } from './redirect-snapshot.entity';
import { RedirectSyncRun } from './redirect-sync-run.entity';
import { RedirectPush } from './redirect-push.entity';
import { RedirectIssue } from './redirect-issue.entity';
import { RedirectAuditRun } from './redirect-audit-run.entity';
import { RedirectBackup } from './redirect-backup.entity';
import { RedirectWpService } from './redirect-wp.service';
import { RedirectSyncService } from './redirect-sync.service';
import { RedirectStatusService } from './redirect-status.service';
import { RedirectWriteService } from './redirect-write.service';
import { RedirectResolveService } from './redirect-resolve.service';
import { RedirectValidateService } from './redirect-validate.service';
import { RedirectAuditService } from './redirect-audit.service';
import { RedirectImportService } from './redirect-import.service';
import { RedirectExportService } from './redirect-export.service';
import { RedirectController } from './redirect.controller';

/**
 * Redirect management module.
 *  - Phase 1: nightly (+ on-demand) READ-ONLY mirror of the Redirection plugin,
 *    append-only change ledger, honest freshness.
 *  - Phase 2: gated writes — create/update/delete/enable-disable stage a PENDING
 *    row in the shared `mcp_change_requests` gate; approval pushes to WP
 *    immediately (verify-after + push ledger + idempotent retry), plus three-way
 *    drift reconciliation. `RedirectWriteService` is exported so `McpChangeModule`
 *    can dispatch approvals to it (that module imports THIS one — no cycle, since
 *    we only reference the `McpChangeRequest` entity here, never that module).
 * The `@Cron`s live in the services (ScheduleModule is global); rollback is
 * removing this module + reverting the migrations.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Site,
      Page,
      GscDaily,
      CrawlPageStatus,
      RedirectItem,
      RedirectSnapshot,
      RedirectSyncRun,
      RedirectPush,
      RedirectIssue,
      RedirectAuditRun,
      RedirectBackup,
      McpChangeRequest,
    ]),
    Ga4Module, // exports Ga4Service (ambient site-level enrichment context)
  ],
  controllers: [RedirectController],
  providers: [
    RedirectWpService,
    RedirectSyncService,
    RedirectStatusService,
    RedirectWriteService,
    RedirectResolveService,
    RedirectValidateService,
    RedirectAuditService,
    RedirectImportService,
    RedirectExportService,
  ],
  exports: [RedirectSyncService, RedirectWriteService],
})
export class RedirectModule {}
