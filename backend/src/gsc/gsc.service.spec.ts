import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios from 'axios';
import { GscService, GscQueryParams } from './gsc.service';
import { GscCache } from './gsc-cache.entity';
import { Site } from '../sites/site.entity';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// ── Regression test for Defect #1 (CRITICAL) ──────────────────────────────────
// GSC dimension filters were silently dropped: query() posted `params` verbatim,
// but the Search Console API ignores a top-level `filters` key and requires
// `dimensionFilterGroups: [{ filters: [...] }]`. Every filtered query therefore
// returned whole-site rows. These tests lock in the corrected request shape and
// the filter semantics that depend on it.

describe('GscService — dimension filter request shape (Defect #1)', () => {
  let service: GscService;

  const cacheRepo = {
    findOne: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
    clear: jest.fn(),
  };
  const siteRepo = {
    findOne: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GscService,
        { provide: getRepositoryToken(GscCache), useValue: cacheRepo },
        { provide: getRepositoryToken(Site), useValue: siteRepo },
      ],
    }).compile();
    service = module.get<GscService>(GscService);
  });

  describe('buildRequestBody — the actual root cause', () => {
    it('wraps filters in dimensionFilterGroups (NOT a top-level filters key)', () => {
      const params: GscQueryParams = {
        startDate: '2026-03-01',
        endDate: '2026-05-31',
        dimensions: ['query'],
        filters: [{ dimension: 'page', operator: 'equals', expression: 'https://poirier.agency/local-seo/' }],
      };

      const body = service.buildRequestBody(params);

      // The bug: a top-level `filters` field is ignored by the GSC API.
      expect(body).not.toHaveProperty('filters');
      expect(body).toEqual(
        expect.objectContaining({
          startDate: '2026-03-01',
          endDate: '2026-05-31',
          dimensions: ['query'],
          dimensionFilterGroups: [
            {
              groupType: 'and',
              filters: [
                { dimension: 'page', operator: 'equals', expression: 'https://poirier.agency/local-seo/' },
              ],
            },
          ],
        }),
      );
    });

    it('omits dimensionFilterGroups entirely when there are no filters', () => {
      const body = service.buildRequestBody({
        startDate: '2026-03-01',
        endDate: '2026-05-31',
        dimensions: ['query'],
      });
      expect(body).not.toHaveProperty('dimensionFilterGroups');
      expect(body).not.toHaveProperty('filters');
    });

    it('maps searchType → type and passes through pagination/aggregation', () => {
      const body = service.buildRequestBody({
        startDate: '2026-03-01',
        endDate: '2026-05-31',
        dimensions: ['page'],
        rowLimit: 25,
        startRow: 10,
        searchType: 'web',
        aggregationType: 'byPage',
      });
      expect(body).toMatchObject({
        type: 'web',
        rowLimit: 25,
        startRow: 10,
        aggregationType: 'byPage',
      });
      expect(body).not.toHaveProperty('searchType');
    });
  });

  describe('filter semantics through query() (mocked GSC API honors dimensionFilterGroups)', () => {
    // Simulated whole-site dataset. Rows are tagged by page + branded flag so the
    // fake API can apply the dimensionFilterGroups it receives — exactly as the
    // real API does, and exactly what the old buggy body failed to trigger.
    const DATASET = [
      { page: 'https://poirier.agency/', query: 'poirier agency', branded: true, clicks: 100, impressions: 1000 },
      { page: 'https://poirier.agency/', query: 'poirier seo', branded: true, clicks: 20, impressions: 300 },
      { page: 'https://poirier.agency/local-seo/', query: 'local seo cape town', branded: false, clicks: 15, impressions: 500 },
      { page: 'https://poirier.agency/local-seo/', query: 'local seo services', branded: false, clicks: 5, impressions: 200 },
      { page: 'https://poirier.agency/blog/', query: 'seo audit checklist', branded: false, clicks: 8, impressions: 400 },
    ];

    function applyFilters(rows: typeof DATASET, body: any): typeof DATASET {
      const groups = body.dimensionFilterGroups as
        | Array<{ filters: Array<{ dimension: string; operator: string; expression: string }> }>
        | undefined;
      if (!groups || groups.length === 0) return rows;
      return rows.filter((r) =>
        groups.every((g) =>
          g.filters.every((f) => {
            const value = f.dimension === 'page' ? r.page : r.query;
            if (f.operator === 'equals') return value === f.expression;
            // crude branded-vs-nonbranded regex split on the query dimension
            if (f.operator === 'includingRegex') return new RegExp(f.expression, 'i').test(value);
            if (f.operator === 'excludingRegex') return !new RegExp(f.expression, 'i').test(value);
            return true;
          }),
        ),
      );
    }

    beforeEach(() => {
      cacheRepo.findOne.mockResolvedValue(null); // always miss → hit the (mocked) API
      cacheRepo.upsert.mockResolvedValue(undefined);
      siteRepo.findOne.mockResolvedValue({ id: 'site-1', url: 'https://poirier.agency' } as Site);

      // Bypass auth + property resolution
      jest.spyOn(service as any, 'getToken').mockResolvedValue('fake-token');
      jest.spyOn(service, 'resolveProperty').mockResolvedValue('sc-domain:poirier.agency');

      // Fake GSC API: respects whatever dimensionFilterGroups the body carries.
      mockedAxios.post.mockImplementation((_url: string, body: any) => {
        const matched = applyFilters(DATASET, body);
        return Promise.resolve({
          data: {
            rows: matched.map((r) => ({
              keys: [r.query],
              clicks: r.clicks,
              impressions: r.impressions,
              ctr: r.impressions ? r.clicks / r.impressions : 0,
              position: 5,
            })),
          },
        }) as any;
      });
    });

    it('(a) a page=equals filter returns ≤ the unfiltered row count', async () => {
      const base: GscQueryParams = { startDate: '2026-03-01', endDate: '2026-05-31', dimensions: ['query'] };

      const unfiltered = await service.query('site-1', base);
      const filtered = await service.query('site-1', {
        ...base,
        filters: [{ dimension: 'page', operator: 'equals', expression: 'https://poirier.agency/local-seo/' }],
      });

      expect(unfiltered.rows.length).toBe(DATASET.length);
      expect(filtered.rows.length).toBeLessThanOrEqual(unfiltered.rows.length);
      expect(filtered.rows.length).toBe(2); // only the two /local-seo/ rows
    });

    it('(b) branded + non-branded click sums reconcile to the unfiltered total', async () => {
      const base: GscQueryParams = { startDate: '2026-03-01', endDate: '2026-05-31', dimensions: ['query'] };
      const sumClicks = (r: { rows: { clicks: number }[] }) =>
        r.rows.reduce((acc, row) => acc + row.clicks, 0);

      const total = sumClicks(await service.query('site-1', base));

      const branded = sumClicks(
        await service.query('site-1', {
          ...base,
          filters: [{ dimension: 'query', operator: 'includingRegex', expression: 'poirier' }],
        }),
      );
      const nonBranded = sumClicks(
        await service.query('site-1', {
          ...base,
          filters: [{ dimension: 'query', operator: 'excludingRegex', expression: 'poirier' }],
        }),
      );

      expect(branded).toBe(120); // 100 + 20
      expect(nonBranded).toBe(28); // 15 + 5 + 8
      expect(branded + nonBranded).toBe(total);
    });
  });
});
