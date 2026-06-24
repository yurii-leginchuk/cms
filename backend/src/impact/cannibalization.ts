import { GscRow } from '../gsc/gsc.service';

export interface CompetingPage {
  page: string;
  clicks: number;
  impressions: number;
  position: number;
}

export interface CannibalConflict {
  query: string;
  totalImpressions: number;
  totalClicks: number;
  /** Pages competing for this query, best (lowest) position first. */
  competingPages: CompetingPage[];
}

/**
 * Keyword cannibalization from GSC `['query','page']` rows: queries where 2+ of
 * the site's pages draw impressions, so multiple URLs compete and split ranking
 * signals. Shared by the agent's `findKeywordCannibalization` tool and the Impact
 * cannibalization endpoint so the two never diverge.
 *
 * When `pageUrl` is set, only conflicts that page actually competes in are kept
 * (the per-page view). Sorted by total impressions; capped at `limit`.
 */
export function detectCannibalization(
  rows: GscRow[],
  opts: { minImpressions?: number; limit?: number; pageUrl?: string } = {},
): CannibalConflict[] {
  const minImpr = opts.minImpressions ?? 10;
  const limit = opts.limit ?? 25;

  const byQuery = new Map<string, CompetingPage[]>();
  for (const r of rows) {
    const query = r.keys?.[0];
    const page = r.keys?.[1];
    if (!query || !page || r.impressions < minImpr) continue;
    if (!byQuery.has(query)) byQuery.set(query, []);
    byQuery.get(query)!.push({
      page,
      clicks: r.clicks,
      impressions: r.impressions,
      position: +r.position.toFixed(1),
    });
  }

  return [...byQuery.entries()]
    .filter(([, pages]) => pages.length >= 2)
    .filter(([, pages]) => (opts.pageUrl ? pages.some((p) => p.page === opts.pageUrl) : true))
    .map(([query, pages]) => ({
      query,
      totalImpressions: pages.reduce((s, p) => s + p.impressions, 0),
      totalClicks: pages.reduce((s, p) => s + p.clicks, 0),
      competingPages: pages.sort((a, b) => a.position - b.position),
    }))
    .sort((a, b) => b.totalImpressions - a.totalImpressions)
    .slice(0, limit);
}
