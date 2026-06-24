import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GscService } from '../gsc/gsc.service';
import { BrandCard } from '../sites/brand-card.entity';
import { BrandFilter } from './impact-series.service';
import { gscMaxAvailable, addDays, diffDays } from './gsc-date';

const TOP_N = 50;

interface QueryRow {
  query: string;
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

interface WindowResult {
  queries: QueryRow[];
  totalClicks: number;
  totalImpressions: number;
}

export interface PageQueryCell {
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

/** One query compared current-vs-previous period for the per-page panel. */
export interface PageQueryRow {
  query: string;
  isRemainder: boolean;
  current: PageQueryCell | null;
  previous: PageQueryCell | null;
  isNew: boolean;
  isLost: boolean;
}

export interface PageQueriesResult {
  pageUrl: string;
  from: string;
  to: string;
  prevFrom: string;
  prevTo: string;
  brand: BrandFilter;
  /** Disclosed query clicks ÷ page-total clicks per period (0..1), or null. */
  currentCoverage: number | null;
  previousCoverage: number | null;
  rows: PageQueryRow[];
}

/**
 * Read-time per-page query drill-down for the Optimization Impact page panel.
 * On-demand (not stored) — every GSC pull rides the 24h gsc_cache. The disclosed
 * queries never sum to the page total (GSC withholds low-volume "anonymized"
 * queries), so a remainder row + a coverage ratio keep that gap explicit.
 * Movement is correlation across periods, not proof of cause.
 */
@Injectable()
export class ImpactQueryService {
  constructor(
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

  async getPageQueries(
    siteId: string,
    opts: { pageUrl: string; from: string; to: string; brand?: BrandFilter },
  ): Promise<PageQueriesResult> {
    const brand: BrandFilter = opts.brand ?? 'all';
    const maxAvailable = gscMaxAvailable();
    const end = opts.to < maxAvailable ? opts.to : maxAvailable;

    const empty: PageQueriesResult = {
      pageUrl: opts.pageUrl, from: opts.from, to: end,
      prevFrom: opts.from, prevTo: opts.from, brand,
      currentCoverage: null, previousCoverage: null, rows: [],
    };
    if (!opts.pageUrl || opts.from > end) return empty;

    // Equal-length immediately-preceding period for the Δ comparison.
    const len = diffDays(opts.from, end) + 1;
    const prevTo = addDays(opts.from, -1);
    const prevFrom = addDays(opts.from, -len);

    let regex: string | null = null;
    if (brand === 'nonbranded') {
      const card = await this.brandRepo.findOne({ where: { siteId } });
      regex = this.brandRegex(card?.brandTerms ?? []);
    }

    const [cur, prev] = await Promise.all([
      this.fetchWindow(siteId, opts.pageUrl, opts.from, end, regex),
      this.fetchWindow(siteId, opts.pageUrl, prevFrom, prevTo, regex),
    ]);

    const byQuery = new Map<string, PageQueryRow>();
    const ensure = (key: string, query: string, isRemainder: boolean): PageQueryRow => {
      let m = byQuery.get(key);
      if (!m) {
        m = { query, isRemainder, current: null, previous: null, isNew: false, isLost: false };
        byQuery.set(key, m);
      }
      return m;
    };
    const cell = (q: QueryRow): PageQueryCell => ({
      clicks: q.clicks, impressions: q.impressions, ctr: q.ctr, position: q.position,
    });
    for (const q of cur.queries) ensure(q.query, q.query, false).current = cell(q);
    for (const q of prev.queries) ensure(q.query, q.query, false).previous = cell(q);

    // Remainder rows reconcile disclosed queries to the page total per period.
    const remCur = this.remainder(cur);
    const remPrev = this.remainder(prev);
    if (remCur || remPrev) {
      const r = ensure('\0remainder', '', true);
      if (remCur) r.current = remCur;
      if (remPrev) r.previous = remPrev;
    }

    const rows = [...byQuery.values()];
    for (const m of rows) {
      if (m.isRemainder) continue;
      m.isNew = !m.previous && !!m.current;
      m.isLost = !!m.previous && !m.current;
    }
    // Biggest absolute clicks movement first; remainder last.
    rows.sort((a, b) => {
      if (a.isRemainder !== b.isRemainder) return a.isRemainder ? 1 : -1;
      const da = Math.abs((a.current?.clicks ?? 0) - (a.previous?.clicks ?? 0));
      const db = Math.abs((b.current?.clicks ?? 0) - (b.previous?.clicks ?? 0));
      return db - da;
    });

    const coverage = (w: WindowResult): number | null => {
      if (!w.totalClicks) return null;
      const disclosed = w.queries.reduce((s, q) => s + q.clicks, 0);
      return +(disclosed / w.totalClicks).toFixed(4);
    };

    return {
      pageUrl: opts.pageUrl, from: opts.from, to: end, prevFrom, prevTo, brand,
      currentCoverage: coverage(cur),
      previousCoverage: coverage(prev),
      rows,
    };
  }

  private remainder(w: WindowResult): PageQueryCell | null {
    const disclosedClicks = w.queries.reduce((s, q) => s + q.clicks, 0);
    const disclosedImpr = w.queries.reduce((s, q) => s + q.impressions, 0);
    const clicks = Math.max(0, w.totalClicks - disclosedClicks);
    const impressions = Math.max(0, w.totalImpressions - disclosedImpr);
    if (clicks === 0 && impressions === 0) return null;
    return { clicks, impressions, ctr: 0, position: 0 };
  }

  private async fetchWindow(
    siteId: string, pageUrl: string, start: string, end: string, regex: string | null,
  ): Promise<WindowResult> {
    const pageFilter = [{ dimension: 'page', operator: 'equals', expression: pageUrl }];
    const brandFilter = regex
      ? [{ dimension: 'query', operator: 'excludingRegex', expression: regex }]
      : [];
    const [qRes, pRes] = await Promise.all([
      this.gsc.query(siteId, {
        startDate: start, endDate: end, dimensions: ['query'], rowLimit: TOP_N,
        searchType: 'web', filters: [...pageFilter, ...brandFilter],
      }),
      this.gsc.query(siteId, {
        startDate: start, endDate: end, dimensions: ['page'], rowLimit: 1,
        searchType: 'web', filters: [...pageFilter, ...brandFilter],
      }),
    ]);
    const queries = (qRes.rows ?? [])
      .filter((r) => r.keys?.[0])
      .map((r) => ({
        query: r.keys[0],
        clicks: r.clicks,
        impressions: r.impressions,
        ctr: +(r.ctr * 100).toFixed(2),
        position: +r.position.toFixed(1),
      }));
    const ptot = pRes.rows?.[0];
    return {
      queries,
      totalClicks: ptot?.clicks ?? 0,
      totalImpressions: ptot?.impressions ?? 0,
    };
  }
}
