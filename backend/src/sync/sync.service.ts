import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import axios from 'axios';
import { SyncJob, SyncJobStatus } from './sync-job.entity';
import { Page, PageSyncStatus } from '../pages/page.entity';
import { Site } from '../sites/site.entity';

/** Minutes to wait before each retry attempt (index = attempt number - 1) */
const BACKOFF_MINUTES = [1, 5, 15, 30];
const MAX_ATTEMPTS = 4;

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    @InjectRepository(SyncJob)
    private readonly jobRepo: Repository<SyncJob>,
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
  ) {}

  /**
   * Called after meta is saved. Creates a new PENDING job or resets an existing
   * non-success job so the latest values will be pushed to WP.
   */
  async enqueue(siteId: string, pageId: string): Promise<void> {
    const latest = await this.jobRepo.findOne({
      where: { pageId },
      order: { createdAt: 'DESC' },
    });

    if (latest && latest.status !== SyncJobStatus.SUCCESS) {
      // Reuse existing job — reset it so the cron / manual trigger picks it up
      await this.jobRepo.update(latest.id, {
        status: SyncJobStatus.PENDING,
        attempts: 0,
        nextRetryAt: null,
        lastError: null,
      });
    } else {
      await this.jobRepo.save(this.jobRepo.create({ siteId, pageId }));
    }

    await this.pageRepo.update(pageId, {
      syncStatus: PageSyncStatus.PENDING,
      syncError: null,
    });
  }

  /**
   * Manually triggered — processes every PENDING job for the site immediately,
   * bypassing the retry timer. Also resets FAILED jobs that are below maxAttempts.
   */
  async triggerSiteSync(siteId: string): Promise<void> {
    // Reset retryable FAILED jobs so we pick them up too
    await this.jobRepo
      .createQueryBuilder()
      .update(SyncJob)
      .set({ status: SyncJobStatus.PENDING, nextRetryAt: null })
      .where('siteId = :siteId', { siteId })
      .andWhere('status = :status', { status: SyncJobStatus.FAILED })
      .andWhere('attempts < maxAttempts')
      .execute();

    const jobs = await this.jobRepo.find({
      where: { siteId, status: SyncJobStatus.PENDING },
    });

    if (jobs.length === 0) return;

    // Fire-and-forget — caller gets 202 immediately
    this.processBatch(siteId, jobs).catch((err) =>
      this.logger.error(`Sync batch failed for site ${siteId}: ${err.message}`),
    );
  }

  private async processBatch(siteId: string, jobs: SyncJob[]): Promise<void> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) return;

    for (const job of jobs) {
      await this.processJob(job, site);
    }
  }

  async processJob(job: SyncJob, site: Site): Promise<void> {
    const page = await this.pageRepo.findOne({ where: { id: job.pageId } });
    if (!page) {
      await this.jobRepo.update(job.id, {
        status: SyncJobStatus.FAILED,
        lastError: 'Page not found',
      });
      return;
    }

    // Mark as in-flight so no other runner picks it up
    await this.jobRepo.update(job.id, { status: SyncJobStatus.PROCESSING });
    await this.pageRepo.update(page.id, { syncStatus: PageSyncStatus.SYNCING });

    try {
      if (!site.wpApiKey) {
        throw new Error('No WP API key configured for this site. Add it in site settings.');
      }

      await axios.post(
        `${site.url}/wp-json/poirier-cms/v1/update-meta`,
        {
          pageUrl: page.url,
          metaTitle: page.customMetaTitle ?? page.metaTitle,
          metaDescription: page.customMetaDescription ?? page.metaDescription,
        },
        {
          timeout: 10_000,
          headers: {
            'Content-Type': 'application/json',
            'X-Poirier-API-Key': site.wpApiKey,
          },
        },
      );

      const now = new Date();
      await this.jobRepo.update(job.id, {
        status: SyncJobStatus.SUCCESS,
        appliedAt: now,
        lastError: null,
      });
      await this.pageRepo.update(page.id, {
        syncStatus: PageSyncStatus.SYNCED,
        syncAppliedAt: now,
        syncError: null,
      });

      this.logger.log(`Synced page ${page.url}`);
    } catch (err) {
      const attempts = job.attempts + 1;
      const errorMsg = axios.isAxiosError(err)
        ? `HTTP ${err.response?.status ?? 'no response'}: ${err.message}`
        : (err as Error).message;

      if (attempts >= MAX_ATTEMPTS) {
        await this.jobRepo.update(job.id, {
          status: SyncJobStatus.FAILED,
          attempts,
          lastError: errorMsg,
        });
        await this.pageRepo.update(page.id, {
          syncStatus: PageSyncStatus.FAILED,
          syncError: errorMsg,
        });
        this.logger.warn(`Sync job ${job.id} permanently failed after ${attempts} attempts`);
      } else {
        const backoffMs = BACKOFF_MINUTES[attempts - 1] * 60 * 1_000;
        const nextRetryAt = new Date(Date.now() + backoffMs);
        await this.jobRepo.update(job.id, {
          status: SyncJobStatus.PENDING,
          attempts,
          nextRetryAt,
          lastError: errorMsg,
        });
        await this.pageRepo.update(page.id, {
          syncStatus: PageSyncStatus.PENDING,
          syncError: errorMsg,
        });
        this.logger.warn(
          `Sync job ${job.id} failed (attempt ${attempts}/${MAX_ATTEMPTS}), retry at ${nextRetryAt.toISOString()}`,
        );
      }
    }
  }

  /**
   * Cron: every minute, pick up PENDING jobs whose retry timer has elapsed.
   */
  @Cron('* * * * *')
  async retryDueJobs(): Promise<void> {
    const due = await this.jobRepo.find({
      where: {
        status: SyncJobStatus.PENDING,
        nextRetryAt: LessThanOrEqual(new Date()),
      },
    });

    if (due.length === 0) return;
    this.logger.log(`Auto-retrying ${due.length} sync job(s)`);

    for (const job of due) {
      const site = await this.siteRepo.findOne({ where: { id: job.siteId } });
      if (site) await this.processJob(job, site);
    }
  }

  /**
   * Aggregate sync status for a site — used by the frontend for the Apply button badge.
   */
  async getSiteStatus(siteId: string): Promise<{
    pending: number;
    syncing: number;
    synced: number;
    failed: number;
  }> {
    const rows = await this.pageRepo
      .createQueryBuilder('page')
      .select('page.syncStatus', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('page.siteId = :siteId', { siteId })
      .andWhere('page.syncStatus != :idle', { idle: PageSyncStatus.IDLE })
      .groupBy('page.syncStatus')
      .getRawMany<{ status: string; count: string }>();

    const result = { pending: 0, syncing: 0, synced: 0, failed: 0 };
    for (const row of rows) {
      const key = row.status as keyof typeof result;
      if (key in result) result[key] = parseInt(row.count, 10);
    }
    return result;
  }
}
