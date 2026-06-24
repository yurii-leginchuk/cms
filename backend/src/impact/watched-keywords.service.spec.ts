import { WatchedKeywordsService, splitWindows } from './watched-keywords.service';
import { datesBetween } from './gsc-date';
import { DayPoint } from './impact-metrics';

function kwRepo(opts: { find?: any[]; findOne?: any } = {}) {
  return {
    find: jest.fn().mockResolvedValue(opts.find ?? []),
    findOne: jest.fn().mockResolvedValue(opts.findOne ?? null),
    create: jest.fn((x: any) => x),
    save: jest.fn(async (x: any) => ({ id: 'new', ...x })),
    delete: jest.fn().mockResolvedValue({ affected: 1 }),
  } as any;
}

/** Stateful keyword_daily fake so the store read/refresh path can be exercised. */
function dailyRepoFake(seed: any[] = []) {
  const store = [...seed];
  return {
    rows: store,
    find: jest.fn(async ({ where }: any) => {
      const lo = where.date?._value?.[0];
      const hi = where.date?._value?.[1];
      return store
        .filter((r) => r.watchedKeywordId === where.watchedKeywordId && r.date >= lo && r.date <= hi)
        .sort((a, b) => (a.date < b.date ? -1 : 1));
    }),
    upsert: jest.fn(async (records: any[]) => {
      for (const rec of records) {
        const i = store.findIndex((r) => r.watchedKeywordId === rec.watchedKeywordId && r.date === rec.date);
        if (i >= 0) store[i] = { ...store[i], ...rec };
        else store.push({ ...rec });
      }
    }),
    delete: jest.fn(),
  } as any;
}

const KW = {
  id: 'k1', siteId: 's1', pageId: null, pageUrl: null,
  query: 'seo tool', normalizedQuery: 'seo tool', source: 'manual',
};

describe('splitWindows', () => {
  const points: DayPoint[] = [
    ...datesBetween('2026-01-01', '2026-01-07').map((date) => ({ date, clicks: 1, impressions: 100, position: 10 })),
    ...datesBetween('2026-01-08', '2026-01-14').map((date) => ({ date, clicks: 2, impressions: 200, position: 5 })),
  ];
  const opts = { from: '2026-01-08', to: '2026-01-14', prevFrom: '2026-01-01', prevTo: '2026-01-07' };

  it('splits into current vs previous and totals clicks', () => {
    const w = splitWindows(points, opts);
    expect(w.current.clicks).toBe(14); // 7 × 2
    expect(w.previous.clicks).toBe(7); // 7 × 1
  });

  it('reports impression-weighted position per window (lower = better)', () => {
    const w = splitWindows(points, opts);
    expect(w.current.position).toBeCloseTo(5, 6);
    expect(w.previous.position).toBeCloseTo(10, 6);
  });

  it('judges hasData by impressions, not row count (zero rows → false)', () => {
    const zeros = datesBetween('2026-01-08', '2026-01-14').map((date) => ({ date, clicks: 0, impressions: 0, position: 0 }));
    expect(splitWindows(zeros, opts).hasData).toBe(false);
    expect(splitWindows(points, opts).hasData).toBe(true);
  });

  it('returns the current-window points only', () => {
    const w = splitWindows(points, opts);
    expect(w.currentPoints).toHaveLength(7);
    expect(w.currentPoints[0].date).toBe('2026-01-08');
  });
});

describe('WatchedKeywordsService.refreshKeyword', () => {
  it('zero-fills every day in the range and upserts (missing GSC days → 0)', async () => {
    const daily = dailyRepoFake();
    const gsc = {
      query: jest.fn().mockResolvedValue({
        rows: [
          { keys: ['2026-01-02'], clicks: 3, impressions: 300, position: 4 },
          { keys: ['2026-01-04'], clicks: 5, impressions: 500, position: 6 },
        ],
      }),
    } as any;
    const svc = new WatchedKeywordsService(kwRepo(), daily, gsc);
    await svc.refreshKeyword(KW as any, '2026-01-01', '2026-01-04');
    expect(daily.upsert).toHaveBeenCalledTimes(1);
    const written = daily.rows;
    expect(written).toHaveLength(4); // 4 days, zero-filled
    expect(written.find((r: any) => r.date === '2026-01-02').clicks).toBe(3);
    expect(written.find((r: any) => r.date === '2026-01-01').impressions).toBe(0);
  });

  it('passes a page filter for page-scoped keywords', async () => {
    const gsc = { query: jest.fn().mockResolvedValue({ rows: [] }) } as any;
    const svc = new WatchedKeywordsService(kwRepo(), dailyRepoFake(), gsc);
    await svc.refreshKeyword(
      { ...KW, pageUrl: 'https://x.com/a' } as any, '2026-01-01', '2026-01-02',
    );
    const filters = gsc.query.mock.calls[0][1].filters;
    expect(filters.some((f: any) => f.dimension === 'page' && f.operator === 'equals')).toBe(true);
  });
});

describe('WatchedKeywordsService.getMonitoring (store path)', () => {
  it('refreshes from GSC when the store is cold, then serves the windows', async () => {
    const daily = dailyRepoFake(); // empty → cold
    const gsc = {
      query: jest.fn(async (_s: string, p: any) =>
        ({ rows: datesBetween(p.startDate, p.endDate).map((date) => ({
          keys: [date], clicks: date >= '2026-01-08' ? 2 : 1,
          impressions: date >= '2026-01-08' ? 200 : 100, position: date >= '2026-01-08' ? 5 : 10,
        })) })),
    } as any;
    const svc = new WatchedKeywordsService(kwRepo({ find: [KW] }), daily, gsc);
    const res = await svc.getMonitoring('s1', { from: '2026-01-08', to: '2026-01-14' });
    expect(gsc.query).toHaveBeenCalled(); // cold store triggered a refresh
    const k = res.keywords[0];
    expect(k.hasData).toBe(true);
    expect(k.current.clicks).toBe(14);
    expect(k.previous.clicks).toBe(7);
    expect(k.points).toHaveLength(7);
  });

  it('serves from the store without hitting GSC when data is present and fresh', async () => {
    const seed = datesBetween('2025-12-04', '2026-01-14').map((date) => ({
      watchedKeywordId: 'k1', siteId: 's1', date,
      clicks: 1, impressions: 100, position: 8, fetchedAt: new Date(),
    }));
    const daily = dailyRepoFake(seed);
    const gsc = { query: jest.fn() } as any;
    const svc = new WatchedKeywordsService(kwRepo({ find: [KW] }), daily, gsc);
    await svc.getMonitoring('s1', { from: '2026-01-08', to: '2026-01-14' });
    expect(gsc.query).not.toHaveBeenCalled();
  });
});

describe('WatchedKeywordsService.create', () => {
  it('returns the existing row instead of duplicating within a scope', async () => {
    const existing = { ...KW };
    const r = kwRepo({ findOne: existing });
    const svc = new WatchedKeywordsService(r, dailyRepoFake(), { query: jest.fn() } as any);
    const out = await svc.create('s1', { query: '  SEO Tool ' });
    expect(out).toBe(existing);
    expect(r.save).not.toHaveBeenCalled();
  });

  it('normalizes the query for de-duplication', async () => {
    const r = kwRepo();
    const svc = new WatchedKeywordsService(r, dailyRepoFake(), { query: jest.fn() } as any);
    await svc.create('s1', { query: '  SEO   Tool ' });
    expect(r.create).toHaveBeenCalledWith(
      expect.objectContaining({ query: 'SEO   Tool', normalizedQuery: 'seo tool' }),
    );
  });
});
