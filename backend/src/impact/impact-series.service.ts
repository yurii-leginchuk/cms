import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, Repository } from 'typeorm';
import { GscService } from '../gsc/gsc.service';
import { BrandCard } from '../sites/brand-card.entity';
import { GscDaily } from './gsc-daily.entity';
import { aggregate, Aggregate, DayPoint } from './impact-metrics';
import {
  GSC_DELAY_DAYS, gscMaxAvailable, addDays, datesBetween, diffDays,
} from './gsc-date';

export type ImpactScope = 'global' | 'page';
export type BrandFilter = 'all' | 'nonbranded';

export interface SeriesPoint extends DayPoint {
  /** True for days within the GSC reporting lag — data is incomplete/absent. */
  provisional: boolean;
}

export interface ImpactSeries {
  scope: ImpactScope;
  pageUrl: string | null;
  brand: BrandFilter;
  from: string;
  to: string;
  points: SeriesPoint[];
  total: Aggregate;
  freshness: {
    /** Most recent day with (potentially) complete data. */
    through: string;
    maxAvailable: string;
    lagDays: number;
    hasBrandSplit: boolean;
    brandTermsCount: number;
    fetchedAt: string | null;
    /** Set when a live refresh failed and stored data is being served. */
    stale?: string;
  };
}

const REFRESH_TAIL_DAYS = 4; // recent days finalize late — always re-pull the tail
const REFRESH_TTL_MS = 12 * 60 * 60 * 1000;

@Injectable()
export class ImpactSeriesService {
  private readonly logger = new Logger(ImpactSeriesService.name);

  constructor(
    @InjectRepository(GscDaily) private readonly dailyRepo: Repository<GscDaily>,
    @InjectRepository(BrandCard) private readonly brandRepo: Repository<BrandCard>,
    private readonly gsc: GscService,
  ) {}

  /** Build a `(?i)(a|b|c)` RE2 expression from brand terms; null if none. */
  private brandRegex(terms: string[]): string | null {
    const clean = terms.map((t) => t.trim()).filter(Boolean);
    if (clean.length === 0) return null;
    const escaped = clean.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    return `(?i)(${escaped.join('|')})`;
  }

  async getSeries(
    siteId: string,
    opts: { scope: ImpactScope; pageUrl?: string; from: string; to: string; brand?: BrandFilter },
  ): Promise<ImpactSeries> {
    const scope = opts.scope;
    const pageUrl = scope === 'page' ? (opts.pageUrl ?? '') : '';
    const brand: BrandFilter = opts.brand ?? 'all';

    const maxAvailable = gscMaxAvailable();
    const needEnd = opts.to < maxAvailable ? opts.to : maxAvailable;

    const card = await this.brandRepo.findOne({ where: { siteId } });
    const brandTerms = card?.brandTerms ?? [];
    const brandRegex = this.brandRegex(brandTerms);

    let stored = await this.loadStored(siteId, scope, pageUrl, opts.from, needEnd);
    // If the brand-split config changed since these rows were fetched (terms added
    // or removed), the stored non-branded columns are stale — re-pull the range.
    const brandMismatch = stored.some((r) => r.hasBrandSplit !== !!brandRegex);
    const refetchStart = brandMismatch && opts.from <= needEnd
      ? opts.from
      : this.refetchStart(stored, opts.from, needEnd);

    let stale: string | undefined;
    if (refetchStart && opts.from <= needEnd) {
      try {
        await this.refresh(siteId, scope, pageUrl, refetchStart, needEnd, brandRegex);
        stored = await this.loadStored(siteId, scope, pageUrl, opts.from, needEnd);
      } catch (err) {
        stale = (err as Error).message;
        this.logger.warn(`Impact series refresh failed (${siteId}/${scope}): ${stale}`);
      }
    }

    const points = this.buildPoints(stored, opts.from, needEnd, opts.to, brand);
    const total = aggregate(points);
    const lastFetched = stored.reduce<Date | null>(
      (acc, r) => (acc && acc > r.fetchedAt ? acc : r.fetchedAt),
      null,
    );

    return {
      scope,
      pageUrl: scope === 'page' ? pageUrl : null,
      brand,
      from: opts.from,
      to: opts.to,
      points,
      total,
      freshness: {
        through: needEnd,
        maxAvailable,
        lagDays: GSC_DELAY_DAYS,
        hasBrandSplit: !!brandRegex,
        brandTermsCount: brandTerms.length,
        fetchedAt: lastFetched ? lastFetched.toISOString() : null,
        ...(stale ? { stale } : {}),
      },
    };
  }

  private async loadStored(
    siteId: string, scope: ImpactScope, pageUrl: string, from: string, to: string,
  ): Promise<GscDaily[]> {
    if (from > to) return [];
    return this.dailyRepo.find({
      where: { siteId, scope, pageUrl, date: Between(from, to) },
      order: { date: 'ASC' },
    });
  }

  /**
   * Earliest day we must re-pull: the first missing day, or — if the cached tail
   * is older than the refresh TTL — the start of the recent tail. null = stored
   * data is complete and fresh enough.
   */
  private refetchStart(stored: GscDaily[], from: string, needEnd: string): string | null {
    if (from > needEnd) return null;
    const have = new Map(stored.map((r) => [r.date, r]));
    for (const day of datesBetween(from, needEnd)) {
      if (!have.has(day)) return day;
    }
    // All present — but recent days finalize late; refresh the tail if stale.
    const tailStart = addDays(needEnd, -(REFRESH_TAIL_DAYS - 1));
    const tail = stored.filter((r) => r.date >= tailStart);
    const tailStale = tail.some((r) => Date.now() - r.fetchedAt.getTime() > REFRESH_TTL_MS);
    return tailStale ? (tailStart < from ? from : tailStart) : null;
  }

  /** Pull [start,end] from GSC (all + optional non-branded) and upsert per day. */
  private async refresh(
    siteId: string, scope: ImpactScope, pageUrl: string,
    start: string, end: string, brandRegex: string | null,
  ): Promise<void> {
    const aggregationType = scope === 'global' ? 'byProperty' : 'byPage';
    const pageFilter = scope === 'page'
      ? [{ dimension: 'page', operator: 'equals', expression: pageUrl }]
      : [];

    const all = await this.gsc.query(siteId, {
      startDate: start, endDate: end, dimensions: ['date'], rowLimit: 1000,
      searchType: 'web', aggregationType, filters: pageFilter,
    });

    let nb: Record<string, { clicks: number; impressions: number; position: number }> = {};
    if (brandRegex) {
      const nbRes = await this.gsc.query(siteId, {
        startDate: start, endDate: end, dimensions: ['date'], rowLimit: 1000,
        searchType: 'web', aggregationType,
        filters: [...pageFilter, { dimension: 'query', operator: 'excludingRegex', expression: brandRegex }],
      });
      for (const row of nbRes.rows ?? []) {
        nb[row.keys[0]] = { clicks: row.clicks, impressions: row.impressions, position: row.position };
      }
    }

    const allByDay = new Map((all.rows ?? []).map((r) => [r.keys[0], r]));
    const now = new Date();
    const records: Partial<GscDaily>[] = datesBetween(start, end).map((date) => {
      const a = allByDay.get(date);
      const clicks = a?.clicks ?? 0;
      const impressions = a?.impressions ?? 0;
      const position = a?.position ?? 0;
      const n = brandRegex ? nb[date] : undefined;
      return {
        siteId, scope, pageUrl, date,
        clicks, impressions, position,
        nbClicks: brandRegex ? (n?.clicks ?? 0) : clicks,
        nbImpressions: brandRegex ? (n?.impressions ?? 0) : impressions,
        nbPosition: brandRegex ? (n?.position ?? 0) : position,
        hasBrandSplit: !!brandRegex,
        fetchedAt: now,
      };
    });

    await this.dailyRepo.upsert(records as GscDaily[], {
      conflictPaths: ['siteId', 'scope', 'pageUrl', 'date'],
      skipUpdateIfNoValuesChanged: false,
    });
  }

  /** Continuous daily points for [from,to], filling absent days with zeros. */
  private buildPoints(
    stored: GscDaily[], from: string, to: string, requestedTo: string, brand: BrandFilter,
  ): SeriesPoint[] {
    const byDay = new Map(stored.map((r) => [r.date, r]));
    const maxAvailable = gscMaxAvailable();
    const out: SeriesPoint[] = [];
    // Render up to the requested end so the lag tail is visible (as provisional),
    // but never beyond today.
    const renderEnd = requestedTo < addDays(maxAvailable, GSC_DELAY_DAYS)
      ? requestedTo : addDays(maxAvailable, GSC_DELAY_DAYS);
    for (const date of datesBetween(from, renderEnd)) {
      const r = byDay.get(date);
      const useNb = brand === 'nonbranded';
      out.push({
        date,
        clicks: r ? (useNb ? r.nbClicks : r.clicks) : 0,
        impressions: r ? (useNb ? r.nbImpressions : r.impressions) : 0,
        position: r ? (useNb ? r.nbPosition : r.position) : 0,
        provisional: diffDays(date, maxAvailable) < 0, // date after last complete day
      });
    }
    return out;
  }
}
