import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, LessThanOrEqual } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { OptimizationEffect } from './optimization-effect.entity';
import {
  OptimizationEffectQuery, EffectQueryWindow,
} from './optimization-effect-query.entity';
import { GscService } from '../gsc/gsc.service';

const GSC_DELAY_DAYS = 3;
const WINDOW_DAYS = 28;
// Wait an onset gap (~14d, for re-crawl/re-index + SERP settle) AND the full
// 28-day result window before auto-measuring, so the measured window sits
// entirely after the change has had a chance to take effect. 14 + 28 = 42.
const MEASURE_AFTER_DAYS = 42;
const ABANDON_AFTER_DAYS = 150; // give up measuring if GSC never returns data
// How many top queries (by clicks) to snapshot per window. The rest collapse
// into a single reconciliation "remainder" row.
const QUERY_SNAPSHOT_TOP_N = 25;

function fmt(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface PageMetrics {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
  hasData: boolean;
}

interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One query merged across both windows for the read API. */
export interface EffectQueryMerged {
  query: string;
  isRemainder: boolean;
  baseline: { clicks: number; impressions: number; ctr: number; position: number } | null;
  result: { clicks: number; impressions: number; ctr: number; position: number } | null;
  isNew: boolean;
  isLost: boolean;
}

export interface EffectQueriesResult {
  effectId: string;
  measured: boolean;
  /** Disclosed query clicks ÷ page-total clicks for each window (0..1), or null. */
  baselineCoverage: number | null;
  resultCoverage: number | null;
  rows: EffectQueryMerged[];
}

@Injectable()
export class OptimizationEffectsService {
  private readonly logger = new Logger(OptimizationEffectsService.name);

  constructor(
    @InjectRepository(OptimizationEffect)
    private readonly repo: Repository<OptimizationEffect>,
    @InjectRepository(OptimizationEffectQuery)
    private readonly queryRepo: Repository<OptimizationEffectQuery>,
    private readonly gscService: GscService,
  ) {}

  /** Window ending `GSC_DELAY_DAYS` ago, spanning `WINDOW_DAYS`. */
  private recentWindow(): { start: string; end: string } {
    const end = new Date(Date.now() - GSC_DELAY_DAYS * 86_400_000);
    const start = new Date(end.getTime() - (WINDOW_DAYS - 1) * 86_400_000);
    return { start: fmt(start), end: fmt(end) };
  }

  private async fetchPageMetrics(
    siteId: string,
    pageUrl: string,
    start: string,
    end: string,
  ): Promise<PageMetrics> {
    const res = await this.gscService.query(siteId, {
      startDate: start,
      endDate: end,
      dimensions: ['page'],
      filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }],
      rowLimit: 1,
      searchType: 'web',
    });
    const row = res.rows?.[0];
    if (!row) return { clicks: 0, impressions: 0, ctr: 0, position: 0, hasData: false };
    return {
      clicks: row.clicks,
      impressions: row.impressions,
      ctr: +(row.ctr * 100).toFixed(2),
      position: +row.position.toFixed(1),
      hasData: true,
    };
  }

  /** Top queries (by clicks) for one page over a window. GSC returns them sorted. */
  private async fetchPageQueries(
    siteId: string,
    pageUrl: string,
    start: string,
    end: string,
  ): Promise<QueryRow[]> {
    const res = await this.gscService.query(siteId, {
      startDate: start,
      endDate: end,
      dimensions: ['query'],
      filters: [{ dimension: 'page', operator: 'equals', expression: pageUrl }],
      rowLimit: QUERY_SNAPSHOT_TOP_N,
      searchType: 'web',
    });
    return (res.rows ?? [])
      .filter((r) => r.keys?.[0])
      .map((r) => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: +(r.ctr * 100).toFixed(2),
        position: +r.position.toFixed(1),
      }));
  }

  /**
   * Snapshot one window's top queries for an effect (best-effort — a GSC failure
   * must never block the baseline/measure it hangs off). Adds a remainder row so
   * the disclosed queries reconcile to the page total (anonymized-query gap).
   */
  private async captureQuerySnapshot(
    effectId: string,
    window: EffectQueryWindow,
    siteId: string,
    pageUrl: string,
    start: string,
    end: string,
    pageClicks: number,
    pageImpressions: number,
  ): Promise<void> {
    try {
      const queries = await this.fetchPageQueries(siteId, pageUrl, start, end);
      // Re-capture is idempotent: clear any prior rows for this window first.
      await this.queryRepo.delete({ effectId, window });
      const rows = queries.map((q) =>
        this.queryRepo.create({
          effectId, window, query: q.query,
          clicks: q.clicks, impressions: q.impressions, ctr: q.ctr, position: q.position,
          isRemainder: false,
        }),
      );
      const disclosedClicks = queries.reduce((s, q) => s + q.clicks, 0);
      const disclosedImpr = queries.reduce((s, q) => s + q.impressions, 0);
      const remClicks = Math.max(0, pageClicks - disclosedClicks);
      const remImpr = Math.max(0, pageImpressions - disclosedImpr);
      if (remClicks > 0 || remImpr > 0) {
        rows.push(this.queryRepo.create({
          effectId, window, query: '', clicks: remClicks, impressions: remImpr,
          ctr: 0, position: 0, isRemainder: true,
        }));
      }
      if (rows.length > 0) await this.queryRepo.save(rows);
    } catch (err) {
      this.logger.warn(
        `Query snapshot (${window}) failed for ${pageUrl}: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Called (fire-and-forget) when a meta change is applied.
   * Snapshots the page's pre-change GSC performance as the baseline.
   */
  async captureBaseline(
    siteId: string,
    pageId: string,
    pageUrl: string,
    changeSummary: string | null,
  ): Promise<void> {
    try {
      const { start, end } = this.recentWindow();
      let metrics: PageMetrics = { clicks: 0, impressions: 0, ctr: 0, position: 0, hasData: false };
      try {
        metrics = await this.fetchPageMetrics(siteId, pageUrl, start, end);
      } catch (err) {
        this.logger.warn(`Baseline GSC fetch failed for ${pageUrl}: ${(err as Error).message}`);
      }
      const saved = await this.repo.save(
        this.repo.create({
          siteId,
          pageId,
          pageUrl,
          changeSummary,
          appliedAt: new Date(),
          baselineStart: start,
          baselineEnd: end,
          baselineClicks: metrics.clicks,
          baselineImpressions: metrics.impressions,
          baselineCtr: metrics.ctr,
          baselinePosition: metrics.position,
          baselineHasData: metrics.hasData,
          status: 'pending',
        }),
      );
      await this.captureQuerySnapshot(
        saved.id, 'baseline', siteId, pageUrl, start, end,
        metrics.clicks, metrics.impressions,
      );
      this.logger.log(`Captured optimization baseline for ${pageUrl}`);
    } catch (err) {
      this.logger.error(`captureBaseline failed for ${pageUrl}: ${(err as Error).message}`);
    }
  }

  async findBySite(siteId: string, pageId?: string): Promise<OptimizationEffect[]> {
    const where: Record<string, unknown> = { siteId };
    if (pageId) where.pageId = pageId;
    return this.repo.find({ where, order: { appliedAt: 'DESC' }, take: 200 });
  }

  /** Measure a single effect now (also used by the cron). */
  async measure(effect: OptimizationEffect): Promise<OptimizationEffect> {
    const { start, end } = this.recentWindow();
    const metrics = await this.fetchPageMetrics(effect.siteId, effect.pageUrl, start, end);
    effect.resultStart = start;
    effect.resultEnd = end;
    effect.resultClicks = metrics.clicks;
    effect.resultImpressions = metrics.impressions;
    effect.resultCtr = metrics.ctr;
    effect.resultPosition = metrics.position;
    effect.measuredAt = new Date();
    effect.status = 'measured';
    const saved = await this.repo.save(effect);
    await this.captureQuerySnapshot(
      effect.id, 'result', effect.siteId, effect.pageUrl, start, end,
      metrics.clicks, metrics.impressions,
    );
    return saved;
  }

  async measureById(siteId: string, id: string): Promise<OptimizationEffect> {
    const effect = await this.repo.findOne({ where: { id, siteId } });
    if (!effect) throw new NotFoundException('Optimization effect not found');
    return this.measure(effect);
  }

  /**
   * The per-query before→after drill-down for one effect: merges the two window
   * snapshots by query, flags new/lost queries, and reports the disclosed-query
   * coverage so the anonymized-query gap stays explicit. Correlation, not cause.
   */
  async getEffectQueries(siteId: string, id: string): Promise<EffectQueriesResult> {
    const effect = await this.repo.findOne({ where: { id, siteId } });
    if (!effect) throw new NotFoundException('Optimization effect not found');
    const rows = await this.queryRepo.find({ where: { effectId: id } });
    const measured = effect.status === 'measured';

    const byQuery = new Map<string, EffectQueryMerged>();
    const keyFor = (r: OptimizationEffectQuery) => (r.isRemainder ? '\0remainder' : r.query);
    for (const r of rows) {
      const key = keyFor(r);
      let m = byQuery.get(key);
      if (!m) {
        m = {
          query: r.query, isRemainder: r.isRemainder,
          baseline: null, result: null, isNew: false, isLost: false,
        };
        byQuery.set(key, m);
      }
      const cell = { clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position };
      if (r.window === 'baseline') m.baseline = cell;
      else m.result = cell;
    }

    // new/lost are only meaningful when the OTHER window was actually snapshotted.
    // Legacy effects (measured before this feature) have no baseline rows, so we
    // must not flag every result query as "new".
    const hasBaselineSnapshot = rows.some((r) => r.window === 'baseline');
    const hasResultSnapshot = rows.some((r) => r.window === 'result');
    const merged = [...byQuery.values()];
    for (const m of merged) {
      if (m.isRemainder) continue;
      m.isNew = hasBaselineSnapshot && !m.baseline && !!m.result;
      m.isLost = hasResultSnapshot && !!m.baseline && !m.result;
    }
    // Biggest movers first (by whichever window has more clicks); remainder last.
    merged.sort((a, b) => {
      if (a.isRemainder !== b.isRemainder) return a.isRemainder ? 1 : -1;
      const av = Math.max(a.result?.clicks ?? 0, a.baseline?.clicks ?? 0);
      const bv = Math.max(b.result?.clicks ?? 0, b.baseline?.clicks ?? 0);
      return bv - av;
    });

    const coverage = (window: EffectQueryWindow, total: number): number | null => {
      if (!total) return null;
      const disclosed = rows
        .filter((r) => r.window === window && !r.isRemainder)
        .reduce((s, r) => s + r.clicks, 0);
      return +(disclosed / total).toFixed(4);
    };

    return {
      effectId: id,
      measured,
      baselineCoverage: coverage('baseline', effect.baselineClicks),
      resultCoverage: measured ? coverage('result', effect.resultClicks ?? 0) : null,
      rows: merged,
    };
  }

  /**
   * Daily: measure pending effects whose post-change window is now complete.
   */
  @Cron('0 6 * * *')
  async measureDueEffects(): Promise<void> {
    const cutoff = new Date(Date.now() - MEASURE_AFTER_DAYS * 86_400_000);
    const due = await this.repo.find({
      where: { status: 'pending', appliedAt: LessThanOrEqual(cutoff) },
      take: 100,
    });
    if (due.length === 0) return;
    this.logger.log(`Measuring ${due.length} optimization effect(s)`);

    for (const effect of due) {
      try {
        await this.measure(effect);
      } catch (err) {
        // Leave pending to retry tomorrow, unless it's hopelessly old
        const ageDays = (Date.now() - new Date(effect.appliedAt).getTime()) / 86_400_000;
        if (ageDays > ABANDON_AFTER_DAYS) {
          effect.status = 'no_data';
          effect.measuredAt = new Date();
          await this.repo.save(effect);
        }
        this.logger.warn(`Measure failed for ${effect.pageUrl}: ${(err as Error).message}`);
      }
    }
  }
}
