import { Processor, WorkerHost, InjectQueue } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Job, Queue } from 'bullmq';
import axios, { AxiosError } from 'axios';
import { PageSpeedResult, PsiStrategy, scoreToCategory } from './page-speed-result.entity';
import { Page } from '../pages/page.entity';
import { SettingsService } from '../settings/settings.service';

export const PAGESPEED_QUEUE = 'pagespeed';

// PSI lab Total Blocking Time is noisy run-to-run. When a result comes back with
// a high TBT we re-scan the page (up to MAX_TBT_RESCANS extra times) to get a
// more representative reading. Re-scanning stops early once TBT drops to/below
// the threshold. Google's "good" TBT band is < 200ms.
const TBT_RESCAN_THRESHOLD_MS = 200;
const MAX_TBT_RESCANS = 3;
const TBT_RESCAN_DELAY_MS = 5_000;

export interface PageSpeedJobData {
  pageId: string;
  siteId: string;
  url: string;
  strategy: PsiStrategy;
  keyIndex: number; // 0 or 1 — which API key to use
  rescanAttempt?: number; // how many TBT re-scans already performed (0 = first run)
}

// 4 parallel workers — 2 per API key slot
@Processor(PAGESPEED_QUEUE, { concurrency: 4 })
export class PageSpeedProcessor extends WorkerHost {
  private readonly logger = new Logger(PageSpeedProcessor.name);

  constructor(
    @InjectRepository(PageSpeedResult)
    private readonly resultRepo: Repository<PageSpeedResult>,
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectQueue(PAGESPEED_QUEUE)
    private readonly queue: Queue<PageSpeedJobData>,
    private readonly settingsService: SettingsService,
  ) {
    super();
  }

  async process(job: Job<PageSpeedJobData>): Promise<void> {
    const { pageId, siteId, url, strategy, keyIndex } = job.data;

    // Load both keys and pick by index
    const keys = (await Promise.all([
      this.settingsService.getRaw('psi_api_key'),
      this.settingsService.getRaw('psi_api_key_2'),
    ])).filter(Boolean) as string[];

    if (keys.length === 0) {
      this.logger.warn('No PSI API keys configured — skipping');
      return;
    }

    const apiKey = keys[keyIndex % keys.length];

    await job.updateProgress({ url, status: 'running' });

    let data: any;
    try {
      const res = await axios.get(
        'https://www.googleapis.com/pagespeedonline/v5/runPagespeed',
        {
          params: { url, strategy, category: 'performance', key: apiKey },
          timeout: 60_000,
        },
      );
      data = res.data;
    } catch (err) {
      if (err instanceof AxiosError) {
        const status = err.response?.status;
        const msg = err.response?.data?.error?.message ?? err.message;
        if (status === 400) {
          this.logger.warn(`PSI 400 for ${url}: ${msg}`);
          return; // bad URL — don't retry
        }
        throw new Error(`PSI API error (${status}): ${msg}`);
      }
      throw err;
    }

    const lh = data.lighthouseResult;
    const score = Math.round((lh?.categories?.performance?.score ?? 0) * 100);
    const audits = lh?.audits ?? {};

    const ms = (key: string) => {
      const v = audits[key]?.numericValue;
      return v != null ? Math.round(v) : null;
    };

    const tbt = ms('total-blocking-time');

    await this.resultRepo.save(
      this.resultRepo.create({
        pageId,
        siteId,
        strategy,
        performanceScore: score,
        category: scoreToCategory(score),
        fcp: ms('first-contentful-paint'),
        lcp: ms('largest-contentful-paint'),
        cls: audits['cumulative-layout-shift']?.numericValue ?? null,
        tbt,
        si: ms('speed-index'),
        ttfb: ms('server-response-time'),
        fetchedAt: new Date(),
      }),
    );

    await job.updateProgress({ url, status: 'done', score });
    this.logger.debug(`PSI [key${keyIndex % keys.length}] ${strategy} ${url} → ${score}`);

    // Re-scan pages with a high (noisy) Total Blocking Time, up to MAX_TBT_RESCANS times.
    const rescanAttempt = job.data.rescanAttempt ?? 0;
    if (tbt != null && tbt > TBT_RESCAN_THRESHOLD_MS && rescanAttempt < MAX_TBT_RESCANS) {
      await this.enqueueTbtRescan(job.data, rescanAttempt + 1, tbt);
    }
  }

  private async enqueueTbtRescan(
    data: PageSpeedJobData,
    rescanAttempt: number,
    tbt: number,
  ): Promise<void> {
    const { pageId, siteId, url, strategy } = data;
    try {
      await this.queue.add(
        `rescan:${pageId}:${strategy}`,
        { ...data, rescanAttempt },
        {
          delay: TBT_RESCAN_DELAY_MS,
          jobId: `psi-rescan:${siteId}:${pageId}:${strategy}:${Date.now()}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 10_000 },
          removeOnComplete: { age: 60 * 60 * 24 },
          removeOnFail: { age: 60 * 60 * 24 * 3 },
        },
      );
      this.logger.log(
        `TBT ${tbt}ms > ${TBT_RESCAN_THRESHOLD_MS}ms for ${url} — re-scan ${rescanAttempt}/${MAX_TBT_RESCANS} queued`,
      );
    } catch (err) {
      this.logger.warn(`Failed to queue TBT re-scan for ${url} — Redis unavailable`);
    }
  }
}
