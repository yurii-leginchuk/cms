import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { GscService, GscQuotaExceededError } from '../gsc/gsc.service';
import { CrawlPageStatus } from './crawl-page-status.entity';
import { CrawlInspection } from './crawl-inspection.entity';
import { normalizeInspection, IndexStatusResult } from './crawl-normalize';

export interface InspectTarget {
  siteId: string;
  property: string;
  url: string;
  pageId: string | null;
  runId: string | null;
}

// Single optional-field shape rather than a discriminated union: the backend
// tsconfig has strictNullChecks off, under which literal-boolean discriminants
// don't narrow reliably. `ok` tells callers which fields are populated.
export interface InspectOutcome {
  ok: boolean;
  changed?: boolean;
  status?: CrawlPageStatus;
  error?: string;
}

/**
 * Shared inspect→normalize→persist path, called by BOTH the nightly scan
 * processor and the synchronous on-demand endpoint. Writes the append-only
 * ledger row only on a real state change (deduped by stateHash), always refreshes
 * the fast per-page status row, and stores the raw payload for retroactive
 * re-normalization. Quota exhaustion is re-thrown so the caller can stop; other
 * failures are captured on the status row and returned as `{ ok: false }`.
 *
 * NOTE: quota reservation/accounting is the CALLER's responsibility (the scan
 * reserves a nightly batch, on-demand reserves against the daily cap).
 */
@Injectable()
export class CrawlInspectService {
  private readonly logger = new Logger(CrawlInspectService.name);

  constructor(
    private readonly gsc: GscService,
    @InjectRepository(CrawlPageStatus)
    private readonly statusRepo: Repository<CrawlPageStatus>,
    @InjectRepository(CrawlInspection)
    private readonly inspectionRepo: Repository<CrawlInspection>,
  ) {}

  async inspectAndPersist(target: InspectTarget): Promise<InspectOutcome> {
    const now = new Date();
    let raw;
    try {
      raw = await this.gsc.inspectUrl(target.property, target.url);
    } catch (err) {
      if (err instanceof GscQuotaExceededError) throw err;
      const message = err instanceof Error ? err.message : String(err);
      await this.recordFailure(target, message);
      return { ok: false, error: message };
    }

    const indexStatus = (raw.indexStatusResult ?? {}) as IndexStatusResult;
    const n = normalizeInspection(indexStatus);

    const existing = await this.statusRepo.findOne({
      where: { siteId: target.siteId, url: target.url },
    });
    const prevHash = existing?.stateHash ?? null;
    const prevIsIndexed = existing?.isIndexed ?? null;
    const prevDerivedStatus = existing?.derivedStatus ?? null;
    const isFirstSeen = !existing || existing.stateHash == null;
    const changed = isFirstSeen || prevHash !== n.stateHash;
    const isDeindexation = prevIsIndexed === true && n.isIndexed === false;

    // Ledger: append only on a genuine state change.
    if (changed) {
      await this.inspectionRepo.insert({
        siteId: target.siteId,
        pageId: target.pageId,
        url: target.url,
        runId: target.runId,
        observedAt: now,
        rawPayload: raw,
        derivedStatus: n.derivedStatus,
        prevDerivedStatus,
        isIndexed: n.isIndexed,
        coverageStateRaw: n.coverageStateRaw,
        verdict: n.verdict,
        indexingState: n.indexingState,
        robotsTxtState: n.robotsTxtState,
        pageFetchState: n.pageFetchState,
        crawledAs: n.crawledAs,
        googleCanonical: n.googleCanonical,
        userCanonical: n.userCanonical,
        canonicalConflict: n.canonicalConflict,
        googleLastCrawlTime: n.googleLastCrawlTime,
        stateHash: n.stateHash,
        prevStateHash: prevHash,
        isDeindexation,
        isFirstSeen,
        mappingVersion: n.mappingVersion,
        apiVersion: n.apiVersion,
      });
    }

    // Fast per-page status: always refreshed.
    const patch: Partial<CrawlPageStatus> = {
      siteId: target.siteId,
      pageId: target.pageId,
      url: target.url,
      derivedStatus: n.derivedStatus,
      isIndexed: n.isIndexed,
      coverageStateRaw: n.coverageStateRaw,
      verdict: n.verdict,
      indexingState: n.indexingState,
      robotsTxtState: n.robotsTxtState,
      pageFetchState: n.pageFetchState,
      crawledAs: n.crawledAs,
      googleCanonical: n.googleCanonical,
      userCanonical: n.userCanonical,
      canonicalConflict: n.canonicalConflict,
      googleLastCrawlTime: n.googleLastCrawlTime,
      lastInspectedAt: now,
      firstSeenAt: existing?.firstSeenAt ?? now,
      stateHash: n.stateHash,
      mappingVersion: n.mappingVersion,
      apiVersion: n.apiVersion,
      lastRunId: target.runId,
      lastError: null,
    };

    let status: CrawlPageStatus;
    if (existing) {
      await this.statusRepo.update({ id: existing.id }, patch);
      status = { ...existing, ...patch } as CrawlPageStatus;
    } else {
      status = await this.statusRepo.save(this.statusRepo.create(patch));
    }
    return { ok: true, changed, status };
  }

  private async recordFailure(target: InspectTarget, message: string): Promise<void> {
    try {
      const existing = await this.statusRepo.findOne({
        where: { siteId: target.siteId, url: target.url },
      });
      if (existing) {
        await this.statusRepo.update({ id: existing.id }, { lastError: message, lastRunId: target.runId });
      } else {
        await this.statusRepo.save(this.statusRepo.create({
          siteId: target.siteId,
          pageId: target.pageId,
          url: target.url,
          lastError: message,
          lastRunId: target.runId,
        }));
      }
    } catch (e) {
      this.logger.warn(`Failed to record inspection error for ${target.url}: ${(e as Error).message}`);
    }
  }
}
