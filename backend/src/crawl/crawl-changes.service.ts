import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrawlInspection } from './crawl-inspection.entity';
import { CrawlScanRun } from './crawl-scan-run.entity';

export type ChangeCategory =
  | 'first_seen'
  | 'deindexed'
  | 'reindexed'
  | 'became_unknown'
  | 'status_change';

export interface ChangeItem {
  id: string;
  url: string;
  observedAt: Date;
  from: string | null;
  to: string | null;
  category: ChangeCategory;
  isIndexed: boolean | null;
  runId: string | null;
}

export interface ChangeDigest {
  runId: string | null;
  trigger: string | null;
  startedAt: Date | null;
  finishedAt: Date | null;
  pagesInspected: number;
  pagesChanged: number;
  hasChanges: boolean;
  categories: Record<ChangeCategory, number>;
  /** Most noteworthy changes first (deindexed → unknown → reindexed → new). */
  highlights: ChangeItem[];
}

const EMPTY_CATEGORIES = (): Record<ChangeCategory, number> => ({
  first_seen: 0, deindexed: 0, reindexed: 0, became_unknown: 0, status_change: 0,
});

// Order used to surface the most important changes first.
const SEVERITY: Record<ChangeCategory, number> = {
  deindexed: 0, became_unknown: 1, reindexed: 2, status_change: 3, first_seen: 4,
};

function categorize(r: CrawlInspection): ChangeCategory {
  if (r.isFirstSeen) return 'first_seen';
  if (r.isDeindexation) return 'deindexed';
  if (r.isIndexed === true && r.prevDerivedStatus && r.prevDerivedStatus !== 'indexed') return 'reindexed';
  if (r.derivedStatus === 'unknown' && r.prevDerivedStatus !== 'unknown') return 'became_unknown';
  return 'status_change';
}

function toItem(r: CrawlInspection): ChangeItem {
  return {
    id: r.id,
    url: r.url,
    observedAt: r.observedAt,
    from: r.prevDerivedStatus,
    to: r.derivedStatus,
    category: categorize(r),
    isIndexed: r.isIndexed,
    runId: r.runId,
  };
}

/**
 * Change analyzer: after each scan, "what happened / what changed". Reads the
 * append-only `crawl_inspections` ledger (which only gets a row on a real state
 * change) and classifies transitions. Powers the post-scan digest (Index Status
 * page + site Overview card) and the recent-changes feed.
 */
@Injectable()
export class CrawlChangesService {
  constructor(
    @InjectRepository(CrawlInspection) private readonly inspectionRepo: Repository<CrawlInspection>,
    @InjectRepository(CrawlScanRun) private readonly runRepo: Repository<CrawlScanRun>,
  ) {}

  /** Digest for the most recent FINISHED run (for Overview + "after scan" report). */
  async latestDigest(siteId: string): Promise<ChangeDigest | null> {
    const run = await this.runRepo.findOne({
      where: { siteId },
      order: { startedAt: 'DESC' },
    });
    if (!run) return null;
    return this.buildDigest(siteId, run);
  }

  async runDigest(siteId: string, runId: string): Promise<ChangeDigest | null> {
    const run = await this.runRepo.findOne({ where: { id: runId, siteId } });
    if (!run) return null;
    return this.buildDigest(siteId, run);
  }

  private async buildDigest(siteId: string, run: CrawlScanRun): Promise<ChangeDigest> {
    const rows = await this.inspectionRepo.find({
      where: { runId: run.id },
      order: { observedAt: 'DESC' },
    });
    const categories = EMPTY_CATEGORIES();
    const items = rows.map((r) => {
      const item = toItem(r);
      categories[item.category] += 1;
      return item;
    });
    items.sort((a, b) => SEVERITY[a.category] - SEVERITY[b.category] || +b.observedAt - +a.observedAt);

    return {
      runId: run.id,
      trigger: run.trigger,
      startedAt: run.startedAt,
      finishedAt: run.finishedAt,
      pagesInspected: run.pagesInspected,
      pagesChanged: run.pagesChanged,
      hasChanges: items.length > 0,
      categories,
      highlights: items.slice(0, 15),
    };
  }

  /** Recent-changes feed across runs (newest first), with optional filters. */
  async recentChanges(
    siteId: string,
    opts: { limit?: number; days?: number; deindexOnly?: boolean } = {},
  ): Promise<ChangeItem[]> {
    const limit = Math.min(500, Math.max(1, opts.limit ?? 100));
    const qb = this.inspectionRepo
      .createQueryBuilder('i')
      .where('i."siteId" = :siteId', { siteId });

    if (opts.days) {
      qb.andWhere(`i."observedAt" >= now() - interval '${Math.floor(opts.days)} days'`);
    }
    if (opts.deindexOnly) {
      qb.andWhere('i."isDeindexation" = true');
    }

    const rows = await qb.orderBy('i."observedAt"', 'DESC').limit(limit).getMany();
    return rows.map(toItem);
  }
}
