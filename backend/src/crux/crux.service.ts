import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import { CruxResult } from './crux-result.entity';
import { Page } from '../pages/page.entity';
import { CRUX_QUEUE, CruxJobData } from './crux.processor';

const FORM_FACTORS = ['PHONE', 'DESKTOP'] as const;

const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 5_000 },
  removeOnComplete: { age: 60 * 60 * 24 * 7 },
  removeOnFail:    { age: 60 * 60 * 24 * 7 },
};

@Injectable()
export class CruxService {
  private readonly logger = new Logger(CruxService.name);

  constructor(
    @InjectRepository(CruxResult) private readonly cruxRepo: Repository<CruxResult>,
    @InjectRepository(Page)       private readonly pageRepo: Repository<Page>,
    @InjectQueue(CRUX_QUEUE)      private readonly queue: Queue<CruxJobData>,
  ) {}

  // ── Trigger ────────────────────────────────────────────────────────────────

  async triggerFetch(siteId: string): Promise<{ queued: number }> {
    const pages = await this.pageRepo.find({ where: { siteId }, select: ['id', 'url'] });

    // 500ms apart → ~120 req/min, well under 150/min CrUX quota
    const jobs = pages.flatMap((page, i) =>
      FORM_FACTORS.map((formFactor, fi) => ({
        name: `crux:${page.id}:${formFactor}`,
        data: { pageId: page.id, siteId, url: page.url, formFactor } as CruxJobData,
        opts: {
          ...JOB_OPTIONS,
          delay: (i * FORM_FACTORS.length + fi) * 500,
          jobId: `crux:${siteId}:${page.id}:${formFactor}`,
        },
      })),
    );

    try {
      await this.queue.addBulk(jobs);
    } catch (err) {
      this.logger.error('Failed to queue CrUX jobs', err);
      throw new Error('Queue unavailable');
    }

    this.logger.log(`Queued ${jobs.length} CrUX jobs for site ${siteId}`);
    return { queued: jobs.length };
  }

  // ── Progress ───────────────────────────────────────────────────────────────

  async getProgress(siteId: string): Promise<{ isRunning: boolean; total: number; completed: number }> {
    const totalPages = await this.pageRepo.count({ where: { siteId } });
    const total = totalPages * FORM_FACTORS.length;

    try {
      const [waiting, delayed, active] = await Promise.all([
        this.queue.getJobs(['waiting']),
        this.queue.getJobs(['delayed']),
        this.queue.getJobs(['active']),
      ]);
      const forSite = (jobs: any[]) => jobs.filter((j) => j.data.siteId === siteId);
      const inQueue = forSite(waiting).length + forSite(delayed).length + forSite(active).length;
      return { isRunning: inQueue > 0, total, completed: Math.max(0, total - inQueue) };
    } catch {
      return { isRunning: false, total, completed: 0 };
    }
  }

  // ── Results ────────────────────────────────────────────────────────────────

  async getSiteResults(siteId: string): Promise<{
    pageId: string; url: string;
    phone: CruxResult | null; desktop: CruxResult | null;
  }[]> {
    const rows: CruxResult[] = await this.cruxRepo.query(
      `SELECT DISTINCT ON ("pageId", "formFactor") *
       FROM crux_results
       WHERE "siteId" = $1
       ORDER BY "pageId", "formFactor", "fetchedAt" DESC`,
      [siteId],
    );

    const byPage = new Map<string, { url: string; phone: CruxResult | null; desktop: CruxResult | null }>();
    for (const row of rows) {
      if (!byPage.has(row.pageId)) byPage.set(row.pageId, { url: row.url, phone: null, desktop: null });
      const entry = byPage.get(row.pageId)!;
      if (row.formFactor === 'PHONE') entry.phone = row;
      else entry.desktop = row;
    }

    return Array.from(byPage.entries()).map(([pageId, v]) => ({ pageId, ...v }));
  }

  async getSiteStats(siteId: string): Promise<{
    phone:   { good: number; ni: number; poor: number; noData: number };
    desktop: { good: number; ni: number; poor: number; noData: number };
    lastFetchedAt: string | null;
  }> {
    const results = await this.getSiteResults(siteId);

    const cwvPass = (r: CruxResult | null): 'good' | 'ni' | 'poor' | 'noData' => {
      if (!r || !r.hasData) return 'noData';
      const cats = [r.lcpCategory, r.clsCategory, r.inpCategory].filter(Boolean);
      if (cats.length === 0) return 'noData';
      if (cats.some((c) => c === 'poor')) return 'poor';
      if (cats.every((c) => c === 'good')) return 'good';
      return 'ni';
    };

    const tally = (key: 'phone' | 'desktop') => {
      const out = { good: 0, ni: 0, poor: 0, noData: 0 };
      for (const r of results) { out[cwvPass(r[key])]++; }
      return out;
    };

    const dates = results
      .flatMap((r) => [r.phone?.fetchedAt, r.desktop?.fetchedAt])
      .filter(Boolean) as Date[];
    const lastFetchedAt = dates.length
      ? new Date(Math.max(...dates.map((d) => new Date(d).getTime()))).toISOString()
      : null;

    return { phone: tally('phone'), desktop: tally('desktop'), lastFetchedAt };
  }

  // ── Monthly cron (1st of each month, 06:00) ────────────────────────────────

  @Cron('0 6 1 * *')
  async handleMonthlyCrux(): Promise<void> {
    this.logger.log('Monthly CrUX fetch triggered');
    const rows = await this.pageRepo.query(`SELECT DISTINCT "siteId" FROM pages`);
    for (const { siteId } of rows) {
      await this.triggerFetch(siteId);
    }
  }
}
