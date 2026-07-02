import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Page } from '../pages/page.entity';
import { CrawlPageStatus } from '../crawl/crawl-page-status.entity';
import { GscDaily } from '../impact/gsc-daily.entity';
import { GSC_TIMEZONE, addDays, gscMaxAvailable } from '../impact/gsc-date';
import { GscWindow, PageSignal } from './audit-detectors/detector-types';
import { parseHeadSignal } from './audit-head';
import { normalizeAuditUrl } from './audit-fingerprint';

/** GSC evidence window (days) — matches the redirect audit's 28d convention. */
const GSC_WINDOW_DAYS = 28;
/** rawHtml is heavy — head-parse the inventory in slices, never all at once. */
const PAGE_BATCH = 50;

/**
 * READERS, not fetchers — the audit's single-source-of-truth layer. Page state
 * comes from the `pages` inventory (nightly parse), Google verdicts from the
 * crawl module's ledger, traffic from the impact module's GSC cache. Nothing
 * here re-computes another module's verdict, and nothing does live HTTP (that
 * is AuditFetchService's bounded job).
 */
@Injectable()
export class AuditSourceService {
  private readonly logger = new Logger(AuditSourceService.name);

  constructor(
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(CrawlPageStatus) private readonly crawlRepo: Repository<CrawlPageStatus>,
    @InjectRepository(GscDaily) private readonly gscRepo: Repository<GscDaily>,
  ) {}

  /** The GSC window the click evidence covers — via gsc-date.ts (GSC reports in
   *  America/Los_Angeles; naive `toISOString().slice(0,10)` drifts a day). */
  gscWindow(): GscWindow {
    const to = gscMaxAvailable();
    return { from: addDays(to, -(GSC_WINDOW_DAYS - 1)), to, timezone: GSC_TIMEZONE };
  }

  /**
   * Load the full page inventory as detector-ready signals: stored-head parse
   * (observed state) + CMS intent fields + crawl verdicts + GSC traffic.
   * `live` stays null — the run service attaches budgeted probes afterwards.
   */
  async loadPageSignals(siteId: string): Promise<PageSignal[]> {
    const [crawlMap, gscMap] = await Promise.all([
      this.loadCrawlMap(siteId),
      this.loadGscMap(siteId),
    ]);

    const out: PageSignal[] = [];
    for (let offset = 0; ; offset += PAGE_BATCH) {
      const batch = await this.pageRepo.find({
        where: { siteId },
        select: [
          'id', 'url', 'rawHtml', 'indexDirective', 'canonical', 'isTransactional',
          'missingFromSitemapAt', 'lastScrapedAt', 'contentStructure',
        ],
        order: { id: 'ASC' },
        skip: offset,
        take: PAGE_BATCH,
      });
      if (batch.length === 0) break;
      for (const p of batch) {
        const subjectKey = normalizeAuditUrl(p.url);
        const gsc = gscMap.get(subjectKey);
        out.push({
          pageId: p.id,
          url: p.url,
          subjectKey,
          head: parseHeadSignal(p.rawHtml),
          intentDirective: p.indexDirective,
          cmsCanonical: p.canonical,
          isTransactional: p.isTransactional,
          missingFromSitemapAt: p.missingFromSitemapAt
            ? new Date(p.missingFromSitemapAt).toISOString()
            : null,
          lastScrapedAt: p.lastScrapedAt ? new Date(p.lastScrapedAt).toISOString() : null,
          wordCount: p.contentStructure?.stats?.wordCount ?? null,
          crawl: crawlMap.get(subjectKey) ?? null,
          gscClicks: gsc?.clicks ?? null,
          gscImpressions: gsc?.impressions ?? null,
          live: null,
        });
      }
      if (batch.length < PAGE_BATCH) break;
    }
    return out;
  }

  private async loadCrawlMap(siteId: string): Promise<Map<string, {
    derivedStatus: string | null;
    pageFetchState: string | null;
    googleCanonical: string | null;
  }>> {
    const rows = await this.crawlRepo.find({
      where: { siteId },
      select: ['url', 'derivedStatus', 'pageFetchState', 'googleCanonical'],
    });
    const map = new Map<string, { derivedStatus: string | null; pageFetchState: string | null; googleCanonical: string | null }>();
    for (const r of rows) {
      if (!r.url) continue;
      map.set(normalizeAuditUrl(r.url), {
        derivedStatus: r.derivedStatus,
        pageFetchState: r.pageFetchState,
        googleCanonical: r.googleCanonical,
      });
    }
    return map;
  }

  private async loadGscMap(siteId: string): Promise<Map<string, { clicks: number; impressions: number }>> {
    const w = this.gscWindow();
    const rows = await this.gscRepo
      .createQueryBuilder('g')
      .select('g."pageUrl"', 'url')
      .addSelect('SUM(g.clicks)', 'clicks')
      .addSelect('SUM(g.impressions)', 'impressions')
      .where('g."siteId" = :siteId AND g.scope = :scope AND g.date >= :from AND g.date <= :to', {
        siteId, scope: 'page', from: w.from, to: w.to,
      })
      .groupBy('g."pageUrl"')
      .getRawMany<{ url: string; clicks: string; impressions: string }>();
    const map = new Map<string, { clicks: number; impressions: number }>();
    for (const r of rows) {
      if (!r.url) continue;
      map.set(normalizeAuditUrl(r.url), {
        clicks: Number(r.clicks),
        impressions: Number(r.impressions),
      });
    }
    return map;
  }
}
