import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { Cron } from '@nestjs/schedule';

import { Page } from '../pages/page.entity';
import { SettingsService } from '../settings/settings.service';
import { SecurityScanRun } from './entities/security-scan-run.entity';
import { SECURITY_QUEUE, SecurityScanJobData } from './security.processor';
import { IncidentService } from './incident.service';
import { RUBRIC_VERSION } from './severity-rubric';
import { NORMALIZATION_VERSION } from './normalize';
import { LEXICON_VERSION } from './detectors/spam-lexicon';
import { ScanRunStatus, SecuritySeverity } from './security.types';

const DEFAULT_RATE_LIMIT_MS = 1000; // gentle spacing between page fetches

const JOB_OPTIONS = {
  attempts: 2,
  backoff: { type: 'fixed' as const, delay: 10_000 },
  removeOnComplete: { age: 60 * 60 * 24 * 7 },
  removeOnFail: { age: 60 * 60 * 24 * 7 },
};

export type SiteHealth = 'never_scanned' | 'scanning' | 'clean' | 'warning' | 'critical';

@Injectable()
export class SecurityScanService {
  private readonly logger = new Logger(SecurityScanService.name);

  constructor(
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(SecurityScanRun) private readonly runRepo: Repository<SecurityScanRun>,
    @InjectQueue(SECURITY_QUEUE) private readonly queue: Queue<SecurityScanJobData>,
    private readonly settings: SettingsService,
    private readonly incidents: IncidentService,
  ) {}

  // ── Trigger ─────────────────────────────────────────────────────────────────

  async triggerScan(siteId: string): Promise<{ runId: string; queued: number }> {
    const pages = await this.pageRepo.find({ where: { siteId }, select: ['id', 'url'] });

    const run = await this.runRepo.save(
      this.runRepo.create({
        siteId,
        status: 'running',
        pagesTotal: pages.length,
        startedAt: new Date(),
        rubricVersion: RUBRIC_VERSION,
        normalizationVersion: NORMALIZATION_VERSION,
        lexiconVersion: LEXICON_VERSION,
      }),
    );

    const rateLimitMs = await this.intSetting('security_rate_limit_ms', DEFAULT_RATE_LIMIT_MS);

    const jobs = pages.map((page, i) => ({
      name: `security:${page.id}`,
      data: { runId: run.id, siteId, pageId: page.id, url: page.url } as SecurityScanJobData,
      opts: { ...JOB_OPTIONS, delay: i * rateLimitMs, jobId: `security:${run.id}:${page.id}` },
    }));

    if (jobs.length > 0) {
      try {
        await this.queue.addBulk(jobs);
      } catch (err) {
        this.logger.error('Failed to queue security jobs', err);
        throw new Error('Queue unavailable');
      }
    }

    this.logger.log(`Queued ${jobs.length} security scan jobs for site ${siteId} (run ${run.id})`);
    return { runId: run.id, queued: jobs.length };
  }

  // ── Progress ──────────────────────────────────────────────────────────────

  async getProgress(siteId: string): Promise<{ isRunning: boolean; total: number; completed: number }> {
    const total = await this.pageRepo.count({ where: { siteId } });
    const inQueue = await this.inQueueForSite(siteId);
    const isRunning = inQueue > 0;
    if (!isRunning) await this.finalizeRun(siteId);
    return { isRunning, total, completed: Math.max(0, total - inQueue) };
  }

  private async inQueueForSite(siteId: string): Promise<number> {
    try {
      const [waiting, delayed, active] = await Promise.all([
        this.queue.getJobs(['waiting']),
        this.queue.getJobs(['delayed']),
        this.queue.getJobs(['active']),
      ]);
      const forSite = (jobs: any[]) => jobs.filter((j) => j.data?.siteId === siteId).length;
      return forSite(waiting) + forSite(delayed) + forSite(active);
    } catch {
      return 0;
    }
  }

  /** Close out the latest running run once its queue has drained. */
  private async finalizeRun(siteId: string): Promise<void> {
    const run = await this.runRepo.findOne({
      where: { siteId, status: 'running' },
      order: { createdAt: 'DESC' },
    });
    if (!run) return;
    const status: ScanRunStatus = run.pagesUnreachable > 0 ? 'partial' : 'completed';
    await this.runRepo.update(run.id, { status, finishedAt: new Date() });
  }

  // ── Overview (health = ordinal, worst-dominant) ─────────────────────────────

  async getOverview(siteId: string): Promise<{
    health: SiteHealth;
    isRunning: boolean;
    lastScanAt: string | null;
    pagesTotal: number;
    pagesScanned: number;
    pagesUnreachable: number;
    openIncidents: number;
    bySeverity: Record<SecuritySeverity, number>;
  }> {
    const inQueue = await this.inQueueForSite(siteId);
    const isRunning = inQueue > 0;
    if (!isRunning) await this.finalizeRun(siteId);

    const lastRun = await this.runRepo.findOne({
      where: { siteId },
      order: { createdAt: 'DESC' },
    });

    const active = await this.incidents.findForSite(siteId, ['open', 'confirmed']);
    const bySeverity: Record<SecuritySeverity, number> = { info: 0, low: 0, medium: 0, high: 0, critical: 0 };
    for (const inc of active) bySeverity[inc.severity]++;

    let health: SiteHealth;
    if (isRunning) health = 'scanning';
    else if (!lastRun) health = 'never_scanned';
    else if (bySeverity.critical > 0 || bySeverity.high > 0) health = 'critical';
    else if (bySeverity.medium > 0 || bySeverity.low > 0) health = 'warning';
    else health = 'clean';

    return {
      health,
      isRunning,
      lastScanAt: lastRun?.startedAt ? lastRun.startedAt.toISOString() : null,
      pagesTotal: lastRun?.pagesTotal ?? (await this.pageRepo.count({ where: { siteId } })),
      pagesScanned: lastRun?.pagesScanned ?? 0,
      pagesUnreachable: lastRun?.pagesUnreachable ?? 0,
      openIncidents: active.length,
      bySeverity,
    };
  }

  // ── Nightly cron (04:00 — offset from the 02:00 parse job) ──────────────────

  @Cron('0 4 * * *')
  async handleNightlyScan(): Promise<void> {
    const enabled = (await this.settings.getRaw('security_scan_enabled')) !== 'false';
    if (!enabled) {
      this.logger.log('Nightly security scan disabled via settings — skipping');
      return;
    }
    this.logger.log('Nightly security scan triggered');
    const rows = await this.pageRepo.query(`SELECT DISTINCT "siteId" FROM pages`);
    for (const { siteId } of rows) {
      await this.triggerScan(siteId);
    }
  }

  private async intSetting(key: string, fallback: number): Promise<number> {
    const raw = await this.settings.getRaw(key);
    const n = raw ? parseInt(raw, 10) : NaN;
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }
}
