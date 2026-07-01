import {
  hostFromUrl, streamMatchesDomain, buildRunReportBody, ga4DateToIso, mapDailyReport, sumMetrics,
} from './ga4-helpers';

describe('hostFromUrl', () => {
  it('strips protocol, www, path and port', () => {
    expect(hostFromUrl('https://www.Poirier.Agency/services/?x=1')).toBe('poirier.agency');
    expect(hostFromUrl('http://sub.example.com:8080/a')).toBe('sub.example.com');
    expect(hostFromUrl('example.com')).toBe('example.com');
  });
});

describe('streamMatchesDomain', () => {
  it('matches exact host', () => {
    expect(streamMatchesDomain('https://poirier.agency', 'https://www.poirier.agency/')).toBe(true);
  });
  it('matches subdomain either direction', () => {
    expect(streamMatchesDomain('https://www.poirier.agency', 'poirier.agency')).toBe(true);
    expect(streamMatchesDomain('https://poirier.agency', 'shop.poirier.agency')).toBe(true);
  });
  it('rejects a different domain', () => {
    expect(streamMatchesDomain('https://other.com', 'poirier.agency')).toBe(false);
    expect(streamMatchesDomain(undefined, 'poirier.agency')).toBe(false);
  });
});

describe('buildRunReportBody', () => {
  it('builds date range, dimensions, metrics', () => {
    const b = buildRunReportBody({ startDate: '2026-05-01', endDate: '2026-05-31', dimensions: ['date'], metrics: ['sessions', 'conversions'] }) as any;
    expect(b.dateRanges).toEqual([{ startDate: '2026-05-01', endDate: '2026-05-31' }]);
    expect(b.dimensions).toEqual([{ name: 'date' }]);
    expect(b.metrics).toEqual([{ name: 'sessions' }, { name: 'conversions' }]);
    expect(b.dimensionFilter).toBeUndefined();
  });
  it('adds the organic-only channel filter', () => {
    const b = buildRunReportBody({ startDate: 'a', endDate: 'b', metrics: ['sessions'], organicOnly: true }) as any;
    expect(b.dimensionFilter.filter.fieldName).toBe('sessionDefaultChannelGroup');
    expect(b.dimensionFilter.filter.stringFilter.value).toBe('Organic Search');
  });
});

describe('ga4DateToIso', () => {
  it('converts YYYYMMDD → YYYY-MM-DD', () => {
    expect(ga4DateToIso('20260531')).toBe('2026-05-31');
    expect(ga4DateToIso('')).toBe('');
  });
});

describe('mapDailyReport + sumMetrics', () => {
  const res = {
    metricHeaders: [{ name: 'sessions' }, { name: 'conversions' }, { name: 'totalRevenue' }],
    rows: [
      { dimensionValues: [{ value: '20260502' }], metricValues: [{ value: '10' }, { value: '2' }, { value: '99.5' }] },
      { dimensionValues: [{ value: '20260501' }], metricValues: [{ value: '5' }, { value: '1' }, { value: '10' }] },
    ],
  };
  it('maps + sorts daily points, coercing numbers', () => {
    const pts = mapDailyReport(res);
    expect(pts.map((p) => p.date)).toEqual(['2026-05-01', '2026-05-02']);
    expect(pts[1]).toMatchObject({ date: '2026-05-02', sessions: 10, conversions: 2, totalRevenue: 99.5 });
  });
  it('handles an empty response', () => {
    expect(mapDailyReport({})).toEqual([]);
    expect(mapDailyReport(undefined)).toEqual([]);
  });
  it('sums metrics across the range', () => {
    expect(sumMetrics(mapDailyReport(res), ['sessions', 'conversions', 'totalRevenue'])).toEqual({
      sessions: 15, conversions: 3, totalRevenue: 109.5,
    });
  });
});
