import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, IsNull, Repository } from 'typeorm';
import { Cron } from '@nestjs/schedule';
import { GscService } from '../gsc/gsc.service';
import { WatchedKeyword, WatchedKeywordSource } from './watched-keyword.entity';
import { KeywordDaily } from './keyword-daily.entity';
import { aggregate, Aggregate, DayPoint } from './impact-metrics';
import { gscMaxAvailable, addDays, diffDays, datesBetween } from './gsc-date';

export interface CreateWatchedKeyword {
  query: string;
  pageId?: string | null;
  pageUrl?: string | null;
  source?: WatchedKeywordSource;
}

export interface KeywordPoint {
  date: string;
  position: number;
  clicks: number;
  provisional: boolean;
}

export interface WatchedKeywordMonitor {
  id: string;
  query: string;
  pageId: string | null;
  pageUrl: string | null;
  source: WatchedKeywordSource;
  hasData: boolean;
  current: Aggregate;
  previous: Aggregate;
  /** Current-window daily points for the trend sparkline. */
  points: KeywordPoint[];
}

export interface KeywordMonitoringResult {
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  keywords: WatchedKeywordMonitor[];
}

const REFRESH_TAIL_DAYS = 4; // recent days finalize late — always re-pull the tail
const REFRESH_TTL_MS = 12 * 60 * 60 * 1000;
const CRON_BACKLOG = 2000; // safety cap on keywords refreshed per cron tick

function normalize(q: string): string {
  return q.trim().toLowerCase().replace(/\s+/g, ' ');
}

interface SplitWindows {
  current: Aggregate;
  previous: Aggregate;
  currentPoints: DayPoint[];
  hasData: boolean;
}

/**
 * Split a keyword's daily points into the current and equal-length previous
 * window and aggregate each (impression-weighted position). Pure — the storage
 * and refresh live in the service. "Has data" is judged by impressions, never row
 * count, because zero-filled days exist for every refreshed day.
 */
export function splitWindows(
  points: DayPoint[],
  opts: { from: string; to: string; prevFrom: string; prevTo: string },
): SplitWindows {
  const inWindow = (lo: string, hi: string) => points.filter((p) => p.date >= lo && p.date <= hi);
  const currentPoints = inWindow(opts.from, opts.to);
  const current = aggregate(currentPoints);
  const previous = aggregate(inWindow(opts.prevFrom, opts.prevTo));
  return {
    current,
    previous,
    currentPoints,
    hasData: current.impressions > 0 || previous.impressions > 0,
  };
}

@Injectable()
export class WatchedKeywordsService {
  private readonly logger = new Logger(WatchedKeywordsService.name);

  constructor(
    @InjectRepository(WatchedKeyword) private readonly repo: Repository<WatchedKeyword>,
    @InjectRepository(KeywordDaily) private readonly dailyRepo: Repository<KeywordDaily>,
    private readonly gsc: GscService,
  ) {}

  list(siteId: string, pageId?: string): Promise<WatchedKeyword[]> {
    return this.repo.find({
      where: { siteId, ...(pageId ? { pageId } : {}) },
      order: { createdAt: 'DESC' },
    });
  }

  /** Idempotent within a (site, page) scope — returns the existing row on a dup. */
  async create(siteId: string, dto: CreateWatchedKeyword): Promise<WatchedKeyword> {
    const query = dto.query.trim().slice(0, 255);
    const normalizedQuery = normalize(query);
    const pageId = dto.pageId ?? null;
    const existing = await this.repo.findOne({
      where: { siteId, pageId: pageId ?? IsNull(), normalizedQuery },
    });
    if (existing) return existing;
    return this.repo.save(this.repo.create({
      siteId,
      pageId,
      pageUrl: dto.pageUrl ?? null,
      query,
      normalizedQuery,
      source: dto.source ?? 'manual',
    }));
  }

  async remove(siteId: string, id: string): Promise<{ ok: true }> {
    const res = await this.repo.delete({ id, siteId });
    if (!res.affected) throw new NotFoundException('Watched keyword not found');
    await this.dailyRepo.delete({ watchedKeywordId: id });
    return { ok: true };
  }

  /**
   * Monitoring for the bounded watched set, served from the persisted daily store
   * (Phase 3.5). On read, any missing days or a stale recent tail are re-pulled
   * from GSC, so history accrues and stays reproducible beyond the 16-month window.
   * Position is impression-weighted (an avg position, never a literal rank).
   */
  async getMonitoring(
    siteId: string,
    opts: { from: string; to: string; pageId?: string },
  ): Promise<KeywordMonitoringResult> {
    const maxAvailable = gscMaxAvailable();
    const end = opts.to < maxAvailable ? opts.to : maxAvailable;
    const len = Math.max(1, diffDays(opts.from, end) + 1);
    const prevTo = addDays(opts.from, -1);
    const prevFrom = addDays(opts.from, -len);

    const keywords = await this.list(siteId, opts.pageId);
    const monitored = await Promise.all(
      keywords.map((kw) => this.monitorOne(kw, opts.from, end, prevFrom, prevTo, maxAvailable)),
    );

    return { from: opts.from, to: end, prevFrom, prevTo, keywords: monitored };
  }

  private async monitorOne(
    kw: WatchedKeyword,
    from: string,
    to: string,
    prevFrom: string,
    prevTo: string,
    maxAvailable: string,
  ): Promise<WatchedKeywordMonitor> {
    const base: WatchedKeywordMonitor = {
      id: kw.id, query: kw.query, pageId: kw.pageId, pageUrl: kw.pageUrl, source: kw.source,
      hasData: false, current: aggregate([]), previous: aggregate([]), points: [],
    };
    try {
      let stored = await this.loadStored(kw.id, prevFrom, to);
      const refetchStart = this.refetchStart(stored, prevFrom, to);
      if (refetchStart) {
        await this.refreshKeyword(kw, refetchStart, to);
        stored = await this.loadStored(kw.id, prevFrom, to);
      }
      const points: DayPoint[] = stored.map((r) => ({
        date: r.date, clicks: r.clicks, impressions: r.impressions, position: r.position,
      }));
      const w = splitWindows(points, { from, to, prevFrom, prevTo });
      base.current = w.current;
      base.previous = w.previous;
      base.hasData = w.hasData;
      base.points = w.currentPoints.map((p) => ({
        date: p.date,
        position: +p.position.toFixed(1),
        clicks: p.clicks,
        provisional: diffDays(p.date, maxAvailable) < 0,
      }));
    } catch (err) {
      this.logger.warn(`Keyword monitor failed for "${kw.query}": ${(err as Error).message}`);
    }
    return base;
  }

  private async loadStored(keywordId: string, from: string, to: string): Promise<KeywordDaily[]> {
    if (from > to) return [];
    return this.dailyRepo.find({
      where: { watchedKeywordId: keywordId, date: Between(from, to) },
      order: { date: 'ASC' },
    });
  }

  /**
   * Earliest day to re-pull: the first missing day, or — if the cached tail is
   * older than the refresh TTL — the start of the recent tail. null = complete
   * and fresh. Mirrors the impact series' refresh logic.
   */
  private refetchStart(stored: KeywordDaily[], from: string, needEnd: string): string | null {
    if (from > needEnd) return null;
    const have = new Map(stored.map((r) => [r.date, r]));
    for (const day of datesBetween(from, needEnd)) {
      if (!have.has(day)) return day;
    }
    const tailStart = addDays(needEnd, -(REFRESH_TAIL_DAYS - 1));
    const tail = stored.filter((r) => r.date >= tailStart);
    const tailStale = tail.some((r) => Date.now() - new Date(r.fetchedAt).getTime() > REFRESH_TTL_MS);
    return tailStale ? (tailStart < from ? from : tailStart) : null;
  }

  /** Pull [start,end] daily from GSC for this keyword and zero-fill upsert. */
  async refreshKeyword(kw: WatchedKeyword, start: string, end: string): Promise<void> {
    if (start > end) return;
    const filters: { dimension: string; operator: string; expression: string }[] = [
      { dimension: 'query', operator: 'equals', expression: kw.query },
    ];
    if (kw.pageUrl) filters.push({ dimension: 'page', operator: 'equals', expression: kw.pageUrl });
    const res = await this.gsc.query(kw.siteId, {
      startDate: start, endDate: end, dimensions: ['date'], rowLimit: 1000,
      searchType: 'web', filters,
    });
    const byDay = new Map<string, { clicks: number; impressions: number; position: number }>();
    for (const r of res.rows ?? []) {
      const date = r.keys?.[0];
      if (date) byDay.set(date, { clicks: r.clicks, impressions: r.impressions, position: r.position });
    }
    const now = new Date();
    const records: Partial<KeywordDaily>[] = datesBetween(start, end).map((date) => {
      const a = byDay.get(date);
      return {
        watchedKeywordId: kw.id, siteId: kw.siteId, date,
        clicks: a?.clicks ?? 0, impressions: a?.impressions ?? 0, position: a?.position ?? 0,
        fetchedAt: now,
      };
    });
    if (records.length === 0) return;
    await this.dailyRepo.upsert(records as KeywordDaily[], {
      conflictPaths: ['watchedKeywordId', 'date'],
      skipUpdateIfNoValuesChanged: false,
    });
  }

  /**
   * Daily: keep the recent tail fresh for every watched keyword, so history keeps
   * accruing even for keywords nobody opened. The set is bounded by construction;
   * deeper backfill happens on demand when a range is viewed.
   */
  @Cron('0 5 * * *')
  async refreshWatchedTail(): Promise<void> {
    const all = await this.repo.find({ take: CRON_BACKLOG });
    if (all.length === 0) return;
    const maxAvailable = gscMaxAvailable();
    const start = addDays(maxAvailable, -(REFRESH_TAIL_DAYS - 1));
    this.logger.log(`Refreshing keyword tail for ${all.length} watched keyword(s)`);
    for (const kw of all) {
      try {
        await this.refreshKeyword(kw, start, maxAvailable);
      } catch (err) {
        this.logger.warn(`Tail refresh failed for "${kw.query}": ${(err as Error).message}`);
      }
    }
  }
}
