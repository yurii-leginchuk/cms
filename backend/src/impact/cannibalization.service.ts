import { Injectable } from '@nestjs/common';
import { GscService } from '../gsc/gsc.service';
import { detectCannibalization, CannibalConflict } from './cannibalization';
import { gscMaxAvailable } from './gsc-date';

export interface CannibalizationResult {
  from: string;
  to: string;
  pageUrl: string | null;
  conflicts: CannibalConflict[];
}

@Injectable()
export class CannibalizationService {
  constructor(private readonly gsc: GscService) {}

  /**
   * Site-wide (no pageUrl) or page-scoped keyword cannibalization for a range.
   * One GSC `['query','page']` pull (rides the 24h cache); detection is the shared
   * pure function so this and the agent tool stay identical.
   */
  async detect(
    siteId: string,
    opts: { from: string; to: string; pageUrl?: string; minImpressions?: number; limit?: number },
  ): Promise<CannibalizationResult> {
    const maxAvailable = gscMaxAvailable();
    const end = opts.to < maxAvailable ? opts.to : maxAvailable;
    const res = await this.gsc.query(siteId, {
      startDate: opts.from,
      endDate: end,
      dimensions: ['query', 'page'],
      rowLimit: 1000,
      searchType: 'web',
    });
    return {
      from: opts.from,
      to: end,
      pageUrl: opts.pageUrl ?? null,
      conflicts: detectCannibalization(res.rows ?? [], {
        minImpressions: opts.minImpressions,
        limit: opts.limit ?? 50,
        pageUrl: opts.pageUrl,
      }),
    };
  }
}
