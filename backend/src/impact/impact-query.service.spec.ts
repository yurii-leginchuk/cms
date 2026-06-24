import { ImpactQueryService } from './impact-query.service';

const PAGE = 'https://x.com/a';
// Both windows sit well before GSC's max-available day, so `end` === `to`.
const FROM = '2026-01-01';
const TO = '2026-01-28';
const PREV_FROM = '2025-12-04'; // from - 28d
const CUR_QUERY_ROWS = [
  { keys: ['alpha'], clicks: 120, impressions: 2000, ctr: 0.06, position: 4 },
  { keys: ['gamma'], clicks: 50, impressions: 800, ctr: 0.06, position: 6 },
];
const PREV_QUERY_ROWS = [
  { keys: ['alpha'], clicks: 40, impressions: 1000, ctr: 0.04, position: 8 },
  { keys: ['beta'], clicks: 20, impressions: 500, ctr: 0.04, position: 12 },
];

function gscStub() {
  return {
    query: jest.fn(async (_siteId: string, p: any) => {
      const current = p.startDate === FROM;
      if (p.dimensions[0] === 'page') {
        return { rows: [{ keys: [PAGE], clicks: current ? 200 : 100, impressions: current ? 5000 : 3000, ctr: 0, position: 0 }] };
      }
      return { rows: current ? CUR_QUERY_ROWS : PREV_QUERY_ROWS };
    }),
  } as any;
}
function brandStub(terms: string[] = []) {
  return { findOne: jest.fn().mockResolvedValue({ brandTerms: terms }) } as any;
}

describe('ImpactQueryService.getPageQueries', () => {
  it('merges current vs previous period by query', async () => {
    const svc = new ImpactQueryService(brandStub(), gscStub());
    const res = await svc.getPageQueries('s1', { pageUrl: PAGE, from: FROM, to: TO, brand: 'all' });
    const alpha = res.rows.find((r) => r.query === 'alpha')!;
    expect(alpha.previous).toEqual({ clicks: 40, impressions: 1000, ctr: 4, position: 8 });
    expect(alpha.current).toEqual({ clicks: 120, impressions: 2000, ctr: 6, position: 4 });
  });

  it('reports disclosed-query coverage for both periods', async () => {
    const svc = new ImpactQueryService(brandStub(), gscStub());
    const res = await svc.getPageQueries('s1', { pageUrl: PAGE, from: FROM, to: TO, brand: 'all' });
    expect(res.currentCoverage).toBeCloseTo(0.85, 4); // (120+50)/200
    expect(res.previousCoverage).toBeCloseTo(0.6, 4); // (40+20)/100
  });

  it('flags new (current-only) and lost (previous-only) queries', async () => {
    const svc = new ImpactQueryService(brandStub(), gscStub());
    const res = await svc.getPageQueries('s1', { pageUrl: PAGE, from: FROM, to: TO, brand: 'all' });
    expect(res.rows.find((r) => r.query === 'gamma')!.isNew).toBe(true);
    expect(res.rows.find((r) => r.query === 'beta')!.isLost).toBe(true);
    expect(res.rows.find((r) => r.query === 'alpha')!.isNew).toBe(false);
  });

  it('adds a remainder row reconciling disclosed queries to the page total', async () => {
    const svc = new ImpactQueryService(brandStub(), gscStub());
    const res = await svc.getPageQueries('s1', { pageUrl: PAGE, from: FROM, to: TO, brand: 'all' });
    const rem = res.rows.find((r) => r.isRemainder)!;
    expect(rem.current!.clicks).toBe(30); // 200 - 170
    expect(rem.previous!.clicks).toBe(40); // 100 - 60
  });

  it('sorts biggest movers first and keeps the remainder row last', async () => {
    const svc = new ImpactQueryService(brandStub(), gscStub());
    const res = await svc.getPageQueries('s1', { pageUrl: PAGE, from: FROM, to: TO, brand: 'all' });
    const order = res.rows.filter((r) => !r.isRemainder).map((r) => r.query);
    expect(order).toEqual(['alpha', 'gamma', 'beta']); // |Δclicks| 80, 50, 20
    expect(res.rows[res.rows.length - 1].isRemainder).toBe(true);
  });

  it('computes an equal-length immediately-preceding comparison window', async () => {
    const svc = new ImpactQueryService(brandStub(), gscStub());
    const res = await svc.getPageQueries('s1', { pageUrl: PAGE, from: FROM, to: TO, brand: 'all' });
    expect(res.prevFrom).toBe(PREV_FROM);
    expect(res.prevTo).toBe('2025-12-31');
  });

  it('applies the brand exclusion filter when non-branded is requested', async () => {
    const gsc = gscStub();
    const svc = new ImpactQueryService(brandStub(['mybrand']), gsc);
    await svc.getPageQueries('s1', { pageUrl: PAGE, from: FROM, to: TO, brand: 'nonbranded' });
    const usedBrandFilter = gsc.query.mock.calls.some(
      ([, p]: any) => (p.filters ?? []).some((f: any) => f.operator === 'excludingRegex'),
    );
    expect(usedBrandFilter).toBe(true);
  });

  it('returns an empty result for a missing page or inverted range', async () => {
    const svc = new ImpactQueryService(brandStub(), gscStub());
    expect((await svc.getPageQueries('s1', { pageUrl: '', from: FROM, to: TO, brand: 'all' })).rows).toEqual([]);
  });
});
