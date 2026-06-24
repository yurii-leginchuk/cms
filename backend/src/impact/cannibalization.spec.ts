import { detectCannibalization } from './cannibalization';

const row = (query: string, page: string, clicks: number, impressions: number, position: number) =>
  ({ keys: [query, page], clicks, impressions, position, ctr: 0 });

describe('detectCannibalization', () => {
  const rows = [
    row('seo tool', '/a', 10, 500, 4),
    row('seo tool', '/b', 5, 300, 9),   // /a and /b compete for "seo tool"
    row('seo audit', '/c', 8, 400, 3),  // only one page → not a conflict
    row('rank checker', '/a', 2, 200, 6),
    row('rank checker', '/d', 1, 150, 8), // /a and /d compete for "rank checker"
    row('tiny', '/a', 0, 5, 2),
    row('tiny', '/e', 0, 4, 3),          // both below minImpressions → dropped
  ];

  it('flags only queries with 2+ competing pages above the impression floor', () => {
    const out = detectCannibalization(rows, { minImpressions: 10 });
    const queries = out.map((c) => c.query).sort();
    expect(queries).toEqual(['rank checker', 'seo tool']);
  });

  it('orders competing pages best (lowest) position first and totals impressions', () => {
    const [top] = detectCannibalization(rows, { minImpressions: 10 });
    expect(top.query).toBe('seo tool'); // highest total impressions → first
    expect(top.totalImpressions).toBe(800);
    expect(top.competingPages.map((p) => p.page)).toEqual(['/a', '/b']);
  });

  it('scopes to conflicts a given page competes in when pageUrl is set', () => {
    const out = detectCannibalization(rows, { minImpressions: 10, pageUrl: '/d' });
    expect(out.map((c) => c.query)).toEqual(['rank checker']);
  });

  it('respects the limit', () => {
    expect(detectCannibalization(rows, { minImpressions: 10, limit: 1 })).toHaveLength(1);
  });

  it('returns nothing when no query has 2+ pages', () => {
    expect(detectCannibalization([row('solo', '/a', 9, 900, 2)], { minImpressions: 10 })).toEqual([]);
  });
});
