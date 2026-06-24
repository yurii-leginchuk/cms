import { computeGscTotals, createSiteTools } from './site-tools';

describe('computeGscTotals (Defect D-A — server-computed GSC totals)', () => {
  it('returns zeros for an empty row set', () => {
    expect(computeGscTotals([])).toEqual({
      clicks: 0,
      impressions: 0,
      ctr: 0,
      avgPosition: 0,
    });
  });

  it('sums clicks and impressions over the FULL row set', () => {
    const rows = [
      { clicks: 10, impressions: 100, position: 5 },
      { clicks: 5, impressions: 200, position: 10 },
      { clicks: 0, impressions: 50, position: 20 },
    ];
    const totals = computeGscTotals(rows);
    expect(totals.clicks).toBe(15);
    expect(totals.impressions).toBe(350);
    // CTR = 15 / 350 = 4.2857% -> 4.29
    expect(totals.ctr).toBe(4.29);
    // Impression-weighted position = (5*100 + 10*200 + 20*50) / 350 = 3500/350 = 10.0
    expect(totals.avgPosition).toBe(10);
  });

  it('matches a manual sum over many rows (no truncation / no undercount)', () => {
    // Simulate a large filtered result set like branded queries (~450 rows).
    const rows = Array.from({ length: 450 }, (_, i) => ({
      clicks: i % 3,
      impressions: (i % 7) + 1,
      position: (i % 15) + 1,
    }));
    const expectedClicks = rows.reduce((s, r) => s + r.clicks, 0);
    const expectedImpr = rows.reduce((s, r) => s + r.impressions, 0);
    const totals = computeGscTotals(rows);
    expect(totals.clicks).toBe(expectedClicks);
    expect(totals.impressions).toBe(expectedImpr);
  });

  it('branded + non-branded totals reconcile to the unfiltered total', () => {
    // Ground-truth-shaped reconciliation check (the headline D-A regression).
    const branded = [
      { clicks: 100, impressions: 1200, position: 6 },
      { clicks: 84, impressions: 1034, position: 8 },
    ];
    const nonBranded = [
      { clicks: 6, impressions: 2500, position: 14 },
      { clicks: 4, impressions: 2086, position: 18 },
    ];
    const brandedTotals = computeGscTotals(branded);
    const nonBrandedTotals = computeGscTotals(nonBranded);
    const allTotals = computeGscTotals([...branded, ...nonBranded]);

    expect(brandedTotals.clicks + nonBrandedTotals.clicks).toBe(allTotals.clicks);
    expect(brandedTotals.impressions + nonBrandedTotals.impressions).toBe(
      allTotals.impressions,
    );
    // Branded impressions reported in full, not a ~50% undercounted partial sum.
    expect(brandedTotals.impressions).toBe(2234);
    expect(nonBrandedTotals.impressions).toBe(4586);
  });
});

describe('querySearchConsole filters (Defect D-B — degenerate filters)', () => {
  // Minimal fake gscService capturing the params it is called with.
  function makeTools() {
    const calls: any[] = [];
    const gscService: any = {
      query: jest.fn(async (_siteId: string, params: any) => {
        calls.push(params);
        return {
          rows: [
            { keys: ['/a'], clicks: 1, impressions: 100, ctr: 0.01, position: 3.6 },
          ],
          _cached: false,
        };
      }),
    };
    const tools = createSiteTools(
      {} as any, // siteRepo
      {} as any, // pageRepo
      'site-1',
      {} as any, // embeddingService
      gscService,
      {} as any, // psiRepo
      {} as any, // settingsService
      {} as any, // briefRepo
      {} as any, // brandCardRepo
    );
    return { tools, gscService, calls };
  }

  it('strips a filter with an empty expression before calling GSC', async () => {
    const { tools, calls } = makeTools();
    await (tools.querySearchConsole as any).execute({
      dateRange: 'last_3_months',
      dimensions: ['page'],
      filters: [
        { dimension: 'page', operator: 'notContains', expression: '' },
        { dimension: 'page', operator: 'equals', expression: '/about-us/' },
      ],
    });
    expect(calls).toHaveLength(1);
    // The empty-expression no-op filter must NOT reach GSC.
    expect(calls[0].filters).toEqual([
      { dimension: 'page', operator: 'equals', expression: '/about-us/' },
    ]);
  });

  it('strips a whitespace-only expression filter', async () => {
    const { tools, calls } = makeTools();
    await (tools.querySearchConsole as any).execute({
      dateRange: 'last_3_months',
      dimensions: ['page'],
      filters: [{ dimension: 'page', operator: 'notContains', expression: '   ' }],
    });
    expect(calls[0].filters).toEqual([]);
  });

  it('includes a server-computed totals field in the payload', async () => {
    const { tools } = makeTools();
    const out: any = await (tools.querySearchConsole as any).execute({
      dateRange: 'last_3_months',
      dimensions: ['page'],
    });
    expect(out.totals).toEqual({
      clicks: 1,
      impressions: 100,
      ctr: 1,
      avgPosition: 3.6,
    });
  });
});
