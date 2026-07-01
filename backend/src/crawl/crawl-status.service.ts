import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, SelectQueryBuilder } from 'typeorm';
import { Site } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { GscService } from '../gsc/gsc.service';
import { CrawlPageStatus } from './crawl-page-status.entity';
import { CrawlInspection } from './crawl-inspection.entity';
import { CrawlScanRun } from './crawl-scan-run.entity';
import { CrawlQuotaService } from './crawl-quota.service';

export interface CrawlListFilters {
  page: number;
  limit: number;
  search?: string;
  segment?: string;      // a derivedStatus, or 'never_checked'
  freshness?: string;    // 'never' | 'stale' | 'fresh'
  canonicalConflict?: boolean;
  sort?: string;         // 'priority' | 'url_asc' | 'stalest' | 'recently_changed'
}

const STALE_DAYS = 14;
const FRESH_DAYS = 2;

@Injectable()
export class CrawlStatusService {
  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(CrawlPageStatus) private readonly statusRepo: Repository<CrawlPageStatus>,
    @InjectRepository(CrawlInspection) private readonly inspectionRepo: Repository<CrawlInspection>,
    @InjectRepository(CrawlScanRun) private readonly runRepo: Repository<CrawlScanRun>,
    private readonly gsc: GscService,
    private readonly quota: CrawlQuotaService,
  ) {}

  /** Overview: coverage WITH denominators, freshness, quota, last run. */
  async getSummary(siteId: string) {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new Error('Site not found');

    const totalPages = await this.pageRepo.count({ where: { siteId } });

    const agg = await this.statusRepo
      .createQueryBuilder('cps')
      .select('COUNT(*) FILTER (WHERE cps."lastInspectedAt" IS NOT NULL)', 'inspected')
      .addSelect('COUNT(*) FILTER (WHERE cps."isIndexed" = true)', 'indexed')
      .addSelect('COUNT(*) FILTER (WHERE cps."isIndexed" = false)', 'not_indexed')
      .addSelect('COUNT(*) FILTER (WHERE cps."isIndexed" IS NULL AND cps."lastInspectedAt" IS NOT NULL)', 'unknown')
      .addSelect('COUNT(*) FILTER (WHERE cps."canonicalConflict" = true)', 'canonical_conflicts')
      .addSelect('MIN(cps."lastInspectedAt")', 'oldest')
      .addSelect('MAX(cps."lastInspectedAt")', 'newest')
      .addSelect(
        'PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now() - cps."lastInspectedAt")))',
        'median_age_s',
      )
      .where('cps."siteId" = :siteId', { siteId })
      .getRawOne<{
        inspected: string; indexed: string; not_indexed: string; unknown: string;
        canonical_conflicts: string; oldest: string | null; newest: string | null;
        median_age_s: string | null;
      }>();

    const byStatusRows = await this.statusRepo
      .createQueryBuilder('cps')
      .select('cps."derivedStatus"', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('cps."siteId" = :siteId AND cps."lastInspectedAt" IS NOT NULL', { siteId })
      .groupBy('cps."derivedStatus"')
      .getRawMany<{ status: string | null; count: string }>();

    const byStatus: Record<string, number> = {};
    for (const r of byStatusRows) if (r.status) byStatus[r.status] = Number(r.count);

    const inspected = Number(agg?.inspected ?? 0);
    const medianAgeS = agg?.median_age_s ? Number(agg.median_age_s) : null;

    // Connection + quota (graceful — never throws if GSC isn't wired up).
    const siteStatus = await this.gsc.getSiteStatus(site.url);
    let quota = null as Awaited<ReturnType<CrawlQuotaService['getState']>> | null;
    if (siteStatus.connected && siteStatus.property) {
      quota = await this.quota.getState(siteStatus.property);
    }

    const lastRun = await this.runRepo.findOne({
      where: { siteId },
      order: { startedAt: 'DESC' },
    });

    return {
      connected: siteStatus.connected,
      connectionReason: siteStatus.reason ?? null,
      property: siteStatus.property ?? null,
      propertyType: siteStatus.property ? this.gsc.propertyType(siteStatus.property) : null,
      coverage: {
        total: totalPages,
        inspected,
        neverChecked: Math.max(0, totalPages - inspected),
        indexed: Number(agg?.indexed ?? 0),
        notIndexed: Number(agg?.not_indexed ?? 0),
        unknown: Number(agg?.unknown ?? 0),
        canonicalConflicts: Number(agg?.canonical_conflicts ?? 0),
        byStatus,
      },
      freshness: {
        oldestInspectedAt: agg?.oldest ?? null,
        newestInspectedAt: agg?.newest ?? null,
        medianAgeDays: medianAgeS != null ? +(medianAgeS / 86400).toFixed(1) : null,
        inspectedCount: inspected,
      },
      quota,
      lastRun: lastRun
        ? {
            id: lastRun.id,
            trigger: lastRun.trigger,
            startedAt: lastRun.startedAt,
            finishedAt: lastRun.finishedAt,
            pagesInspected: lastRun.pagesInspected,
            pagesChanged: lastRun.pagesChanged,
            pagesErrored: lastRun.pagesErrored,
            pagesSkippedQuota: lastRun.pagesSkippedQuota,
          }
        : null,
    };
  }

  /** Paginated page list (inventory LEFT JOIN status) with filters + sort. */
  async listPages(siteId: string, f: CrawlListFilters) {
    const page = Math.max(1, f.page);
    const limit = Math.min(200, Math.max(1, f.limit));

    const base = () => this.applyFilters(
      this.pageRepo
        .createQueryBuilder('p')
        .leftJoin('crawl_page_status', 'cps', 'cps."pageId" = p.id')
        .where('p."siteId" = :siteId', { siteId }),
      f,
    );

    const total = await base().getCount();

    let qb = base()
      .select([
        'p.id AS "pageId"',
        'p.url AS url',
        'p."isTransactional" AS "isTransactional"',
        'cps."derivedStatus" AS "derivedStatus"',
        'cps."isIndexed" AS "isIndexed"',
        'cps."coverageStateRaw" AS "coverageStateRaw"',
        'cps.verdict AS verdict',
        'cps."indexingState" AS "indexingState"',
        'cps."robotsTxtState" AS "robotsTxtState"',
        'cps."pageFetchState" AS "pageFetchState"',
        'cps."crawledAs" AS "crawledAs"',
        'cps."googleCanonical" AS "googleCanonical"',
        'cps."userCanonical" AS "userCanonical"',
        'cps."canonicalConflict" AS "canonicalConflict"',
        'cps."googleLastCrawlTime" AS "googleLastCrawlTime"',
        'cps."lastInspectedAt" AS "lastInspectedAt"',
        'cps."lastError" AS "lastError"',
      ]);

    qb = this.applySort(qb, f.sort);

    const rows = await qb
      .limit(limit)
      .offset((page - 1) * limit)
      .getRawMany();

    return {
      data: rows.map((r) => ({
        ...r,
        isTransactional: !!r.isTransactional,
        canonicalConflict: !!r.canonicalConflict,
      })),
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /** Per-page detail: current status + latest raw inspection payload. */
  async getPageDetail(siteId: string, pageId: string) {
    const page = await this.pageRepo.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new Error('Page not found');

    const status = await this.statusRepo.findOne({ where: { siteId, url: page.url } });
    const latest = await this.inspectionRepo.findOne({
      where: { siteId, url: page.url },
      order: { observedAt: 'DESC' },
    });

    const raw = (latest?.rawPayload ?? null) as { inspectionResultLink?: string } | null;

    return {
      pageId: page.id,
      url: page.url,
      isTransactional: page.isTransactional,
      declaredCanonical: page.canonical,
      status: status ?? null,
      latest: latest
        ? {
            observedAt: latest.observedAt,
            inspectionResultLink: raw?.inspectionResultLink ?? null,
            rawPayload: latest.rawPayload,
          }
        : null,
    };
  }

  /** Per-page state-change history (newest first). */
  async getPageHistory(siteId: string, pageId: string) {
    const page = await this.pageRepo.findOne({ where: { id: pageId, siteId } });
    if (!page) throw new Error('Page not found');

    const rows = await this.inspectionRepo.find({
      where: { siteId, url: page.url },
      order: { observedAt: 'DESC' },
      take: 100,
    });

    return rows.map((r) => ({
      id: r.id,
      observedAt: r.observedAt,
      derivedStatus: r.derivedStatus,
      isIndexed: r.isIndexed,
      coverageStateRaw: r.coverageStateRaw,
      canonicalConflict: r.canonicalConflict,
      googleLastCrawlTime: r.googleLastCrawlTime,
      isFirstSeen: r.isFirstSeen,
      isDeindexation: r.isDeindexation,
    }));
  }

  async getQuota(siteId: string) {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new Error('Site not found');
    const siteStatus = await this.gsc.getSiteStatus(site.url);
    if (!siteStatus.connected || !siteStatus.property) {
      return { connected: false, reason: siteStatus.reason ?? 'not_connected' };
    }
    const state = await this.quota.getState(siteStatus.property);
    return { connected: true, ...state };
  }

  // ── Sitemap (discovery nudge) ────────────────────────────────────────────

  /** The site's sitemap + everything GSC currently knows about its sitemaps. */
  async getSitemapInfo(siteId: string) {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new Error('Site not found');
    const siteStatus = await this.gsc.getSiteStatus(site.url);
    if (!siteStatus.connected || !siteStatus.property) {
      return { connected: false, reason: siteStatus.reason ?? 'not_connected', siteSitemapUrl: site.sitemapUrl };
    }
    let sitemaps: Awaited<ReturnType<GscService['listSitemaps']>> = [];
    try {
      sitemaps = await this.gsc.listSitemaps(siteStatus.property);
    } catch {
      sitemaps = [];
    }
    return {
      connected: true,
      property: siteStatus.property,
      siteSitemapUrl: site.sitemapUrl,
      sitemaps,
    };
  }

  /**
   * Resubmit the site's sitemap to GSC (discovery nudge). Then the operator
   * re-inspects the affected pages later and the change analyzer reports whether
   * anything got discovered/indexed — closing the loop.
   */
  async resubmitSitemap(siteId: string) {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new Error('Site not found');
    if (!site.sitemapUrl) throw new Error('This site has no sitemap URL configured');
    const property = await this.gsc.resolveProperty(site.url);
    await this.gsc.submitSitemap(property, site.sitemapUrl);
    return { ok: true, property, sitemapUrl: site.sitemapUrl, submittedAt: new Date().toISOString() };
  }

  // ── filter / sort helpers ────────────────────────────────────────────────

  private applyFilters(qb: SelectQueryBuilder<Page>, f: CrawlListFilters): SelectQueryBuilder<Page> {
    if (f.search) qb.andWhere('p.url ILIKE :search', { search: `%${f.search}%` });

    if (f.segment === 'never_checked') {
      qb.andWhere('cps."lastInspectedAt" IS NULL');
    } else if (f.segment) {
      qb.andWhere('cps."derivedStatus" = :segment', { segment: f.segment });
    }

    if (f.canonicalConflict) qb.andWhere('cps."canonicalConflict" = true');

    if (f.freshness === 'never') {
      qb.andWhere('cps."lastInspectedAt" IS NULL');
    } else if (f.freshness === 'stale') {
      qb.andWhere(`cps."lastInspectedAt" < now() - interval '${STALE_DAYS} days'`);
    } else if (f.freshness === 'fresh') {
      qb.andWhere(`cps."lastInspectedAt" >= now() - interval '${FRESH_DAYS} days'`);
    }

    return qb;
  }

  private applySort(qb: SelectQueryBuilder<Page>, sort?: string): SelectQueryBuilder<Page> {
    switch (sort) {
      case 'url_asc':
        return qb.orderBy('p.url', 'ASC');
      case 'stalest':
        return qb.orderBy('cps."lastInspectedAt"', 'ASC', 'NULLS FIRST');
      case 'recently_changed':
        return qb.orderBy('cps."updatedAt"', 'DESC', 'NULLS LAST');
      case 'priority':
      default:
        return qb
          .orderBy('p."isTransactional"', 'DESC')
          .addOrderBy('cps."canonicalConflict"', 'DESC', 'NULLS LAST')
          .addOrderBy('cps."lastInspectedAt"', 'ASC', 'NULLS FIRST');
    }
  }
}
