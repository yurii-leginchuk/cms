import { createHash } from 'crypto';
import { diffDays } from './gsc-date';
import { ChangeEvent } from './change-event';

/** Short, stable content hash for a cluster id. */
export function shortHash(input: string): string {
  return createHash('sha1').update(input).digest('hex').slice(0, 16);
}

/**
 * Deterministic TOTAL order: (day asc, ts asc, id asc). The final `id` tiebreak
 * is what makes greedy clustering reproducible — two events with the same `ts`
 * must never compare equal (the old `return 0` made grouping non-deterministic).
 */
export function compareEventsAsc(a: ChangeEvent, b: ChangeEvent): number {
  if (a.day !== b.day) return a.day < b.day ? -1 : 1;
  if (a.ts !== b.ts) return a.ts < b.ts ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Anchor-fixed greedy clustering. Sorts a COPY by the total order, then sweeps:
 * take the earliest ungrouped event as the anchor and pull in every later event
 * within `windowDays` of the ANCHOR's day (not the previous member's — chaining a
 * run of 1-day gaps could transitively merge a whole month). Mutates each event's
 * `clusterId`.
 *
 * `level` + `partitionKey` scope the id so global and per-page cluster ids for the
 * same day never collide. The caller decides the partition by WHAT it passes in:
 * a site-wide event set (global) or a single page's events (per-page).
 */
export function assignClusters(
  events: ChangeEvent[],
  windowDays: number,
  level: 'global' | 'page',
  partitionKey: string,
): void {
  const sorted = [...events].sort(compareEventsAsc);
  let i = 0;
  while (i < sorted.length) {
    const anchor = sorted[i];
    const members: ChangeEvent[] = [anchor];
    let j = i + 1;
    while (j < sorted.length && diffDays(anchor.day, sorted[j].day) <= windowDays) {
      members.push(sorted[j]);
      j++;
    }
    const memberIds = members.map((m) => m.id).sort();
    const clusterId = shortHash(
      `${level}|${partitionKey}|${anchor.day}|${windowDays}|${memberIds.join(',')}`,
    );
    for (const m of members) m.clusterId = clusterId;
    i = j;
  }
}
