import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Site } from '../sites/site.entity';
import { Page } from '../pages/page.entity';
import { GscService, GscQuotaExceededError } from '../gsc/gsc.service';
import { CrawlScanRun, CrawlScanTrigger } from './crawl-scan-run.entity';
import { CrawlQuotaService, NIGHTLY_BUDGET, DAILY_CAP } from './crawl-quota.service';
import { CrawlInspectService } from './crawl-inspect.service';
import { API_VERSION, MAPPING_VERSION } from './crawl-normalize';

/** Min spacing between inspections to respect the 600/min per-property limit. */
const THROTTLE_MS = 120;

interface Candidate {
  pageId: string;
  url: string;
}

@Injectable()
export class CrawlScanService {
  private readonly logger = new Logger(CrawlScanService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(CrawlScanRun) private readonly runRepo: Repository<CrawlScanRun>,
    private readonly gsc: GscService,
    private readonly quota: CrawlQuotaService,
    private readonly inspect: CrawlInspectService,
  ) {}

  // Every day at 1:00 AM — before the 2 AM nightly parse. Index status is
  // independent of scrape/sync, so it leads the nightly chain.
  @Cron('0 1 * * *')
  async handleNightlyScan(): Promise<void> {
    this.logger.log('Nightly index-inspection scan triggered');
    await this.runForAllSites();
  }

  async runForAllSites(): Promise<void> {
    const sites = await this.siteRepo.find();
    for (const site of sites) {
      try {
        await this.runForSite(site.id, 'nightly');
      } catch (err) {
        this.logger.error(`Index scan failed for site ${site.id}: ${(err as Error).message}`);
      }
    }
  }

  /**
   * Run one scan for a site: resolve the property, reserve a nightly quota
   * batch, and inspect a prioritized rotation of pages (money pages →
   * never-inspected → oldest). Records a lineage row throughout.
   */
  async runForSite(siteId: string, trigger: CrawlScanTrigger): Promise<CrawlScanRun> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new Error('Site not found');

    const run = await this.runRepo.save(this.runRepo.create({
      siteId,
      trigger,
      apiVersion: API_VERSION,
      mappingVersion: MAPPING_VERSION,
      selectionStrategy: 'transactional,never_inspected_nulls_first,oldest_rotation',
    }));

    try {
      const property = await this.gsc.resolveProperty(site.url);
      const propertyType = this.gsc.propertyType(property);
      run.property = property;
      run.propertyType = propertyType;

      // Nightly leaves on-demand headroom (nightly budget); a fresh-site backfill
      // fills up as much as TODAY's hard cap allows. Either way, pages beyond the
      // granted quota are NOT sent — they roll to the next scan (never-inspected
      // is prioritized NULLS FIRST), so we never exceed the daily limit.
      const ceiling = trigger === 'nightly' ? 'nightly' : 'daily';
      const perRunLimit = ceiling === 'nightly' ? NIGHTLY_BUDGET : DAILY_CAP;

      const candidates = await this.selectPages(siteId, perRunLimit);
      run.pagesSelected = candidates.length;

      const granted = await this.quota.reserve(property, siteId, candidates.length, ceiling);
      run.quotaBudget = granted;
      const skippedAtReserve = Math.max(0, candidates.length - granted);

      const errorBreakdown: Record<string, number> = {};
      let inspected = 0;
      let changed = 0;
      let errored = 0;
      let skippedMidRun = 0;
      let remainingReserved = granted;

      for (const c of candidates.slice(0, granted)) {
        try {
          const outcome = await this.inspect.inspectAndPersist({
            siteId, property, url: c.url, pageId: c.pageId, runId: run.id,
          });
          remainingReserved -= 1;
          inspected += 1;
          if (outcome.ok) {
            if (outcome.changed) changed += 1;
          } else {
            errored += 1;
            errorBreakdown.transport = (errorBreakdown.transport ?? 0) + 1;
          }
        } catch (err) {
          if (err instanceof GscQuotaExceededError) {
            // Google says we're out even though the ledger had budget (shared
            // usage). Release the untouched reservations and stop.
            await this.quota.release(property, remainingReserved);
            skippedMidRun = remainingReserved;
            this.logger.warn(`Quota exhausted mid-scan for ${property}; stopping`);
            break;
          }
          errored += 1;
          errorBreakdown.other = (errorBreakdown.other ?? 0) + 1;
        }
        if (THROTTLE_MS > 0) await sleep(THROTTLE_MS);
      }

      run.pagesInspected = inspected;
      run.pagesChanged = changed;
      run.pagesErrored = errored;
      run.pagesSkippedQuota = skippedAtReserve + skippedMidRun;
      run.errorBreakdown = errorBreakdown;
      run.finishedAt = new Date();
      return await this.runRepo.save(run);
    } catch (err) {
      run.fatalError = (err as Error).message;
      run.finishedAt = new Date();
      return await this.runRepo.save(run);
    }
  }

  /**
   * On-demand: inspect a set of pages now, reserving against the hard DAILY cap
   * (so manual re-checks can use the headroom the nightly budget leaves).
   * Returns per-URL results and the quota actually granted.
   */
  async inspectPagesOnDemand(
    siteId: string,
    pageIds: string[],
  ): Promise<{
    property: string;
    requested: number;
    granted: number;
    results: Array<{ pageId: string; url: string; ok: boolean; changed?: boolean; error?: string }>;
  }> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new Error('Site not found');
    const property = await this.gsc.resolveProperty(site.url);

    const pages = await this.pageRepo.find({
      where: pageIds.map((id) => ({ id, siteId })),
      select: ['id', 'url'],
    });

    const run = await this.runRepo.save(this.runRepo.create({
      siteId, trigger: 'on_demand', property, propertyType: this.gsc.propertyType(property),
      apiVersion: API_VERSION, mappingVersion: MAPPING_VERSION, selectionStrategy: 'on_demand',
      pagesSelected: pages.length,
    }));

    const granted = await this.quota.reserve(property, siteId, pages.length, 'daily');
    run.quotaBudget = granted;

    const results: Array<{ pageId: string; url: string; ok: boolean; changed?: boolean; error?: string }> = [];
    let remainingReserved = granted;
    let inspected = 0;
    let changed = 0;
    let errored = 0;

    for (const p of pages.slice(0, granted)) {
      try {
        const outcome = await this.inspect.inspectAndPersist({
          siteId, property, url: p.url, pageId: p.id, runId: run.id,
        });
        remainingReserved -= 1;
        inspected += 1;
        if (outcome.ok) {
          if (outcome.changed) changed += 1;
          results.push({ pageId: p.id, url: p.url, ok: true, changed: outcome.changed });
        } else {
          errored += 1;
          results.push({ pageId: p.id, url: p.url, ok: false, error: outcome.error });
        }
      } catch (err) {
        if (err instanceof GscQuotaExceededError) {
          await this.quota.release(property, remainingReserved);
          break;
        }
        errored += 1;
        results.push({ pageId: p.id, url: p.url, ok: false, error: (err as Error).message });
      }
      await sleep(THROTTLE_MS);
    }

    // Pages that couldn't be inspected because the daily cap was already spent.
    for (const p of pages.slice(granted)) {
      results.push({ pageId: p.id, url: p.url, ok: false, error: 'daily_quota_exhausted' });
    }

    run.pagesInspected = inspected;
    run.pagesChanged = changed;
    run.pagesErrored = errored;
    run.pagesSkippedQuota = pages.length - granted;
    run.finishedAt = new Date();
    await this.runRepo.save(run);

    return { property, requested: pages.length, granted, results };
  }

  /**
   * Prioritized rotation from the `pages` inventory joined to current status:
   * money pages first, then never-inspected (NULLS FIRST), then oldest freshness.
   */
  private async selectPages(siteId: string, limit: number): Promise<Candidate[]> {
    const rows = await this.pageRepo
      .createQueryBuilder('p')
      .leftJoin('crawl_page_status', 'cps', 'cps."pageId" = p.id')
      .select(['p.id AS "pageId"', 'p.url AS url'])
      .where('p.siteId = :siteId', { siteId })
      .orderBy('p."isTransactional"', 'DESC')
      .addOrderBy('(cps."lastInspectedAt" IS NULL)', 'DESC')
      .addOrderBy('cps."lastInspectedAt"', 'ASC', 'NULLS FIRST')
      .limit(limit)
      .getRawMany<Candidate>();
    return rows;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
