import { assignClusters, compareEventsAsc, shortHash } from './change-cluster';
import { ChangeEvent } from './change-event';

/** Minimal event factory for clustering tests. */
function ev(id: string, day: string, ts?: string, pageId: string | null = 'p1'): ChangeEvent {
  return {
    id,
    type: 'meta',
    category: 'meta-title',
    clusterId: '',
    subtype: 't',
    pageId,
    pageUrl: '',
    ts: ts ?? `${day}T12:00:00.000Z`,
    day,
    precision: 'timestamp',
    summary: '',
    before: null,
    after: null,
    measurable: true,
    effectStatus: null,
    effectId: null,
    confoundedWith: 0,
  };
}

const WINDOW = 2;

describe('compareEventsAsc (total order)', () => {
  it('orders by day, then ts, then id — never returns 0 for distinct ids', () => {
    const a = ev('a', '2026-06-10', '2026-06-10T09:00:00.000Z');
    const b = ev('b', '2026-06-10', '2026-06-10T09:00:00.000Z'); // same day+ts
    expect(compareEventsAsc(a, b)).toBe(-1); // id 'a' < 'b'
    expect(compareEventsAsc(b, a)).toBe(1);
  });
});

describe('assignClusters (anchor-fixed greedy sweep)', () => {
  it('groups events within the window into one cluster', () => {
    const events = [ev('a', '2026-06-10'), ev('b', '2026-06-11'), ev('c', '2026-06-12')];
    assignClusters(events, WINDOW, 'global', 'site1');
    expect(new Set(events.map((e) => e.clusterId)).size).toBe(1);
  });

  it('is INCLUSIVE at the window boundary (exactly 2 days apart groups)', () => {
    const events = [ev('a', '2026-06-10'), ev('b', '2026-06-12')]; // diff = 2 = window
    assignClusters(events, WINDOW, 'global', 'site1');
    expect(events[0].clusterId).toBe(events[1].clusterId);
  });

  it('starts a new cluster once past the window (3 days apart)', () => {
    const events = [ev('a', '2026-06-10'), ev('b', '2026-06-13')]; // diff = 3 > window
    assignClusters(events, WINDOW, 'global', 'site1');
    expect(events[0].clusterId).not.toBe(events[1].clusterId);
  });

  it('is ANCHOR-fixed, not neighbor-chained (a run of 1-day gaps does NOT merge everything)', () => {
    // 4 events one day apart: 10,11,12,13. Anchor=10 pulls 10,11,12 (<=2); 13 is >2 from 10.
    const events = [
      ev('a', '2026-06-10'),
      ev('b', '2026-06-11'),
      ev('c', '2026-06-12'),
      ev('d', '2026-06-13'),
    ];
    assignClusters(events, WINDOW, 'global', 'site1');
    const ids = events.map((e) => e.clusterId);
    expect(new Set(ids).size).toBe(2); // {10,11,12} and {13} — NOT one chained cluster
    expect(ids[0]).toBe(ids[1]);
    expect(ids[1]).toBe(ids[2]);
    expect(ids[3]).not.toBe(ids[0]);
  });

  it('is deterministic under input reorder (clusterId stable)', () => {
    const forward = [ev('a', '2026-06-10'), ev('b', '2026-06-11'), ev('c', '2026-06-12')];
    const shuffled = [ev('c', '2026-06-12'), ev('a', '2026-06-10'), ev('b', '2026-06-11')];
    assignClusters(forward, WINDOW, 'global', 'site1');
    assignClusters(shuffled, WINDOW, 'global', 'site1');
    const byId = (arr: ChangeEvent[]) => Object.fromEntries(arr.map((e) => [e.id, e.clusterId]));
    expect(byId(shuffled)).toEqual(byId(forward));
  });

  it('scopes the id by level + partitionKey (global vs page never collide)', () => {
    const g = [ev('a', '2026-06-10')];
    const p = [ev('a', '2026-06-10')];
    assignClusters(g, WINDOW, 'global', 'site1');
    assignClusters(p, WINDOW, 'page', 'page1');
    expect(g[0].clusterId).not.toBe(p[0].clusterId);
  });

  it('separates two same-day clusters in different partitions when called per-partition', () => {
    const pageA = [ev('a', '2026-06-10', undefined, 'pA')];
    const pageB = [ev('b', '2026-06-10', undefined, 'pB')];
    assignClusters(pageA, WINDOW, 'page', 'pA');
    assignClusters(pageB, WINDOW, 'page', 'pB');
    expect(pageA[0].clusterId).not.toBe(pageB[0].clusterId);
  });
});

describe('shortHash', () => {
  it('is stable and 16 hex chars', () => {
    expect(shortHash('x')).toBe(shortHash('x'));
    expect(shortHash('x')).toMatch(/^[0-9a-f]{16}$/);
    expect(shortHash('x')).not.toBe(shortHash('y'));
  });
});
