import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { CrawlQuotaLedger } from './crawl-quota-ledger.entity';

export const DAILY_CAP = 2000;
export const NIGHTLY_BUDGET = 1500;

/**
 * Bucket a moment into Google's quota-reset day (America/Los_Angeles), as
 * YYYY-MM-DD. The URL-Inspection daily quota resets on Pacific midnight, NOT on
 * the UTC inspection timestamp — reusing UTC (or the impact module's LA-bucketed
 * gsc-date helper, which is for a different data set) would drift the ledger.
 */
export function pacificDate(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export interface QuotaState {
  property: string;
  quotaDate: string;
  used: number;
  capDaily: number;
  budgetNightly: number;
  remainingDaily: number;
  remainingNightly: number;
}

@Injectable()
export class CrawlQuotaService {
  constructor(
    @InjectRepository(CrawlQuotaLedger)
    private readonly ledgerRepo: Repository<CrawlQuotaLedger>,
  ) {}

  /** Read today's quota state for a property (creating no row). */
  async getState(property: string, now: Date = new Date()): Promise<QuotaState> {
    const quotaDate = pacificDate(now);
    const row = await this.ledgerRepo.findOne({ where: { property, quotaDate } });
    const used = row?.used ?? 0;
    const capDaily = row?.capDaily ?? DAILY_CAP;
    const budgetNightly = row?.budgetNightly ?? NIGHTLY_BUDGET;
    return {
      property,
      quotaDate,
      used,
      capDaily,
      budgetNightly,
      remainingDaily: Math.max(0, capDaily - used),
      remainingNightly: Math.max(0, budgetNightly - used),
    };
  }

  /**
   * Atomically reserve up to `count` inspections against a ceiling, returning how
   * many were actually granted (0..count). `ceiling='nightly'` reserves against
   * `budgetNightly` (leaving headroom for on-demand); `'daily'` reserves against
   * the hard `capDaily`. Uses a row-locked transaction so the cron and on-demand
   * paths can never overspend between them.
   */
  async reserve(
    property: string,
    siteId: string | null,
    count: number,
    ceiling: 'nightly' | 'daily',
    now: Date = new Date(),
  ): Promise<number> {
    if (count <= 0) return 0;
    const quotaDate = pacificDate(now);

    return this.ledgerRepo.manager.transaction(async (mgr) => {
      // Ensure the row exists (idempotent) so the FOR UPDATE lock has a target.
      await mgr
        .createQueryBuilder()
        .insert()
        .into(CrawlQuotaLedger)
        .values({ property, siteId, quotaDate, used: 0, capDaily: DAILY_CAP, budgetNightly: NIGHTLY_BUDGET })
        .orIgnore()
        .execute();

      const row = await mgr
        .createQueryBuilder(CrawlQuotaLedger, 'q')
        .setLock('pessimistic_write')
        .where('q.property = :property AND q.quotaDate = :quotaDate', { property, quotaDate })
        .getOne();

      if (!row) return 0;

      const cap = ceiling === 'nightly' ? row.budgetNightly : row.capDaily;
      const granted = Math.max(0, Math.min(count, cap - row.used));
      if (granted > 0) {
        await mgr.update(CrawlQuotaLedger, { id: row.id }, { used: row.used + granted });
      }
      return granted;
    });
  }

  /**
   * Release reservations that were granted but not spent (e.g. an inspection
   * threw a transport error before hitting Google). Best-effort; never negative.
   */
  async release(property: string, count: number, now: Date = new Date()): Promise<void> {
    if (count <= 0) return;
    const quotaDate = pacificDate(now);
    await this.ledgerRepo
      .createQueryBuilder()
      .update(CrawlQuotaLedger)
      .set({ used: () => `GREATEST(0, "used" - ${Math.floor(count)})` })
      .where('property = :property AND quotaDate = :quotaDate', { property, quotaDate })
      .execute();
  }
}
