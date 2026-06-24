import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';
import axios, { AxiosError } from 'axios';
import { PageSpeedResult, PsiStrategy } from './page-speed-result.entity';
import { Page } from '../pages/page.entity';
import { PAGESPEED_QUEUE, PageSpeedJobData } from './page-speed.processor';
import { SettingsService } from '../settings/settings.service';

export type ScanMode = 'all' | 'needs_improvement';

export interface AuditIssue {
  id: string;
  title: string;
  displayValue: string | null;
  savingsMs: number | null;
  score: number | null;
}

export interface PageAuditResult {
  url: string;
  score: number;
  issues: AuditIssue[];
}

const DEFAULT_STRATEGY: PsiStrategy = 'mobile';
const JOB_OPTIONS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 10_000 },
  removeOnComplete: { age: 60 * 60 * 24 },
  removeOnFail: { age: 60 * 60 * 24 * 3 },
};

@Injectable()
export class PageSpeedService {
  private readonly logger = new Logger(PageSpeedService.name);

  constructor(
    @InjectRepository(PageSpeedResult)
    private readonly resultRepo: Repository<PageSpeedResult>,
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectQueue(PAGESPEED_QUEUE)
    private readonly queue: Queue<PageSpeedJobData>,
    private readonly settingsService: SettingsService,
  ) {}

  // ── Trigger ────────────────────────────────────────────────────────────────

  async triggerScan(
    siteId: string,
    strategy: PsiStrategy = DEFAULT_STRATEGY,
    mode: ScanMode = 'all',
  ): Promise<{ queued: number; keyCount: number }> {
    try {
      await this.cancelPendingScan(siteId, strategy);
    } catch {
      this.logger.warn('Redis unavailable — skipping cancelPendingScan');
    }

    // Determine how many keys are configured
    const [key1, key2] = await Promise.all([
      this.settingsService.getRaw('psi_api_key'),
      this.settingsService.getRaw('psi_api_key_2'),
    ]);
    const keyCount = [key1, key2].filter(Boolean).length;

    const pages =
      mode === 'needs_improvement'
        ? await this.getPagesNeedingImprovement(siteId, strategy)
        : await this.pageRepo.find({
            where: { siteId },
            select: ['id', 'url'],
          });

    // With 2 keys: no delay — worker concurrency=2 handles parallelism
    // With 1 key: 600ms stagger to stay within PSI rate limits
    const delayPerJob = keyCount >= 2 ? 0 : 600;
    const scanId = Date.now();

    const jobs = pages.map((page, i) => ({
      name: `scan:${page.id}:${strategy}`,
      data: {
        pageId: page.id,
        siteId,
        url: page.url,
        strategy,
        keyIndex: i % keyCount || 0,
      },
      opts: {
        ...JOB_OPTIONS,
        delay: delayPerJob > 0 ? i * delayPerJob : 0,
        jobId: `psi:${siteId}:${page.id}:${strategy}:${scanId}`,
      },
    }));

    try {
      await this.queue.addBulk(jobs);
    } catch (err) {
      this.logger.error('Failed to queue PSI jobs — Redis unavailable', err);
      throw new Error('Queue unavailable. Make sure Redis is running.');
    }
    this.logger.log(`Queued ${jobs.length} PSI jobs for site ${siteId} [${strategy}] using ${keyCount} key(s)`);
    return { queued: jobs.length, keyCount };
  }

  async cancelPendingScan(siteId: string, strategy: PsiStrategy): Promise<void> {
    const waiting = await this.queue.getJobs(['waiting', 'delayed']);
    const toRemove = waiting.filter(
      (j) => j.data.siteId === siteId && j.data.strategy === strategy,
    );
    await Promise.all(toRemove.map((j) => j.remove()));
  }

  // Pages whose latest result is below the "good" band (category != 'good').
  // Mirrors scoreToCategory: score >= 90 → good, everything else needs improvement.
  private async getPagesNeedingImprovement(
    siteId: string,
    strategy: PsiStrategy,
  ): Promise<{ id: string; url: string }[]> {
    return this.resultRepo.query(
      `SELECT latest.id, latest.url
       FROM (
         SELECT DISTINCT ON (r."pageId")
           r."pageId" AS id, p.url, r.category
         FROM page_speed_results r
         JOIN pages p ON p.id = r."pageId"
         WHERE r."siteId" = $1 AND r.strategy = $2
         ORDER BY r."pageId", r."fetchedAt" DESC
       ) latest
       WHERE latest.category <> 'good'`,
      [siteId, strategy],
    );
  }

  // ── Progress ────────────────────────────────────────────────────────────────

  async getProgress(siteId: string, strategy: PsiStrategy = DEFAULT_STRATEGY): Promise<{
    isRunning: boolean;
    total: number;
    completed: number;
    failed: number;
    currentUrl: string | null;
    currentUrls: string[];
  }> {
    const totalPages = await this.pageRepo.count({ where: { siteId } });

    try {
      const [waiting, delayed, active, failed] = await Promise.all([
        this.queue.getJobs(['waiting']),
        this.queue.getJobs(['delayed']),
        this.queue.getJobs(['active']),
        this.queue.getJobs(['failed']),
      ]);

      const forSite = (jobs: any[]) =>
        jobs.filter((j) => j.data.siteId === siteId && j.data.strategy === strategy);

      const pendingCount = forSite(waiting).length + forSite(delayed).length;
      const activeCount = forSite(active).length;
      const failedCount = forSite(failed).length;

      const isRunning = pendingCount > 0 || activeCount > 0;
      const inQueue = pendingCount + activeCount + failedCount;
      const completed = Math.max(0, totalPages - inQueue);

      const activeJobs = forSite(active);
      const currentUrls = activeJobs
        .map((j) => (j.progress as any)?.url)
        .filter(Boolean) as string[];
      const currentUrl = currentUrls[0] ?? null;

      return { isRunning, total: totalPages, completed, failed: failedCount, currentUrl, currentUrls };
    } catch {
      // Redis unavailable — report idle state
      return { isRunning: false, total: totalPages, completed: 0, failed: 0, currentUrl: null, currentUrls: [] };
    }
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  async getSiteStats(siteId: string, strategy: PsiStrategy = DEFAULT_STRATEGY): Promise<{
    good: number;
    needs_improvement: number;
    poor: number;
    avgScore: number;
    lastScanAt: Date | null;
    trend: { date: string; avgScore: number }[];
  }> {
    // Latest score per page
    const latestScores = await this.resultRepo.query(
      `SELECT DISTINCT ON ("pageId")
         "pageId", "performanceScore", category, "fetchedAt"
       FROM page_speed_results
       WHERE "siteId" = $1 AND strategy = $2
       ORDER BY "pageId", "fetchedAt" DESC`,
      [siteId, strategy],
    );

    const good = latestScores.filter((r: any) => r.category === 'good').length;
    const ni = latestScores.filter((r: any) => r.category === 'needs_improvement').length;
    const poor = latestScores.filter((r: any) => r.category === 'poor').length;
    const avgScore = latestScores.length
      ? Math.round(latestScores.reduce((s: number, r: any) => s + parseInt(r.performanceScore), 0) / latestScores.length)
      : 0;
    const lastScanAt = latestScores.reduce((max: Date | null, r: any) => {
      const d = new Date(r.fetchedAt);
      return !max || d > max ? d : max;
    }, null);

    // Daily average trend (last 30 days)
    const trend: { date: string; avgScore: number }[] = await this.resultRepo.query(
      `SELECT
         to_char(date_trunc('day', "fetchedAt"), 'YYYY-MM-DD') AS date,
         ROUND(AVG("performanceScore")) AS "avgScore"
       FROM page_speed_results
       WHERE "siteId" = $1
         AND strategy = $2
         AND "fetchedAt" >= NOW() - INTERVAL '30 days'
       GROUP BY date_trunc('day', "fetchedAt")
       ORDER BY 1`,
      [siteId, strategy],
    );

    return { good, needs_improvement: ni, poor, avgScore, lastScanAt, trend };
  }

  async getPageResults(pageId: string, strategy: PsiStrategy = DEFAULT_STRATEGY): Promise<PageSpeedResult[]> {
    return this.resultRepo.find({
      where: { pageId, strategy },
      order: { fetchedAt: 'DESC' },
      take: 30,
    });
  }

  async getSiteResults(siteId: string, strategy: PsiStrategy = DEFAULT_STRATEGY): Promise<{
    pageId: string; url: string; performanceScore: number;
    category: string; lcp: number | null; cls: number | null;
    fcp: number | null; tbt: number | null; fetchedAt: Date;
  }[]> {
    return this.resultRepo.query(
      `SELECT DISTINCT ON (r."pageId")
         r."pageId", p.url, r."performanceScore", r.category,
         r.lcp, r.cls, r.fcp, r.tbt, r."fetchedAt"
       FROM page_speed_results r
       JOIN pages p ON p.id = r."pageId"
       WHERE r."siteId" = $1 AND r.strategy = $2
       ORDER BY r."pageId", r."fetchedAt" DESC`,
      [siteId, strategy],
    );
  }

  // ── Live audit ────────────────────────────────────────────────────────────

  async analyzePageLive(pageId: string, siteId: string, strategy: PsiStrategy = DEFAULT_STRATEGY): Promise<PageAuditResult> {
    const page = await this.pageRepo.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new Error('Page not found');

    const apiKey = await this.settingsService.getRaw('psi_api_key');
    if (!apiKey) throw new Error('No PSI API key configured');

    let data: any;
    try {
      const res = await axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
        params: { url: page.url, strategy, category: 'performance', key: apiKey },
        timeout: 60_000,
      });
      data = res.data;
    } catch (err) {
      const msg = err instanceof AxiosError ? (err.response?.data?.error?.message ?? err.message) : String(err);
      throw new Error(`PSI error: ${msg}`);
    }

    const lh = data?.lighthouseResult;
    const score = Math.round((lh?.categories?.performance?.score ?? 0) * 100);
    const audits: Record<string, any> = lh?.audits ?? {};

    const issues: AuditIssue[] = Object.values(audits)
      .filter((a) => a.score !== null && a.score < 0.9 && a.details?.type !== 'debugdata' && a.title)
      .sort((a, b) => {
        // Sort by savings first, then by score ascending
        const sa = a.details?.overallSavingsMs ?? 0;
        const sb = b.details?.overallSavingsMs ?? 0;
        if (sb !== sa) return sb - sa;
        return (a.score ?? 1) - (b.score ?? 1);
      })
      .slice(0, 8)
      .map((a) => ({
        id: a.id,
        title: a.title,
        displayValue: a.displayValue ?? null,
        savingsMs: a.details?.overallSavingsMs ? Math.round(a.details.overallSavingsMs) : null,
        score: a.score != null ? Math.round(a.score * 100) : null,
      }));

    return { url: page.url, score, issues };
  }

  // ── Daily cron ─────────────────────────────────────────────────────────────

  @Cron('0 4 * * *')
  async handleDailyScan(): Promise<void> {
    this.logger.log('Daily PageSpeed scan triggered');
    const rows = await this.pageRepo.query(
      `SELECT DISTINCT "siteId" FROM pages`,
    );
    for (const { siteId } of rows) {
      await this.triggerScan(siteId, 'mobile');
      await this.triggerScan(siteId, 'desktop');
    }
  }
}
