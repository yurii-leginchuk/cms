import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import axios, { AxiosError } from 'axios';
import { Ga4Service } from './ga4.service';
import { Site } from '../sites/site.entity';
import { loadGoogleCreds } from '../common/google/google-auth';

jest.mock('axios', () => {
  const actual = jest.requireActual('axios');
  return {
    ...actual,
    default: { ...actual.default, get: jest.fn(), post: jest.fn() },
  };
});
jest.mock('../common/google/google-auth', () => ({
  getGoogleAccessToken: jest.fn().mockResolvedValue('test-token'),
  loadGoogleCreds: jest.fn().mockResolvedValue({ client_email: 'sa@test.iam' }),
}));

const mockedAxios = axios as jest.Mocked<typeof axios>;
const mockedLoadCreds = loadGoogleCreds as jest.Mock;

function axiosErrorWithStatus(status: number): AxiosError {
  const err = new AxiosError(`HTTP ${status}`);
  err.response = { status } as never;
  return err;
}

// ── Regression tests for the intermittent "GA4 missing on Impact page" bug ────
// Root cause: every cold cache re-walked the GA4 Admin API (accountSummaries +
// dataStreams per property) with no persistence, no in-flight dedup and no
// retry; any quota/timeout hiccup surfaced as connected:false and the UI
// silently dropped GA4. These tests lock in: persisted property short-circuit,
// persist-after-discovery, shared concurrent walk, mapping invalidation on 403,
// and retry-on-transient semantics.

describe('Ga4Service', () => {
  let service: Ga4Service;

  const siteRepo = {
    findOne: jest.fn(),
    update: jest.fn().mockResolvedValue(undefined),
  };

  const SITE_ID = '2cbf49ec-30a0-4ba8-8910-37be1911734b';
  const baseSite = {
    id: SITE_ID,
    url: 'https://poirier.agency',
    ga4PropertyId: null,
    ga4PropertyName: null,
    ga4StreamUri: null,
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockedLoadCreds.mockResolvedValue({ client_email: 'sa@test.iam' });
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        Ga4Service,
        { provide: getRepositoryToken(Site), useValue: siteRepo },
      ],
    }).compile();
    service = module.get<Ga4Service>(Ga4Service);
  });

  describe('getSiteStatus', () => {
    it('returns no_credentials without touching the network when creds are missing', async () => {
      siteRepo.findOne.mockResolvedValue({ ...baseSite });
      mockedLoadCreds.mockRejectedValue(new Error('no creds file'));

      await expect(service.getSiteStatus(SITE_ID)).resolves.toEqual({
        connected: false,
        reason: 'no_credentials',
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
    });

    it('answers from the persisted property without any Admin API call', async () => {
      siteRepo.findOne.mockResolvedValue({
        ...baseSite,
        ga4PropertyId: '375919623',
        ga4PropertyName: 'Poirier Agency',
        ga4StreamUri: 'https://poirier.agency',
      });

      await expect(service.getSiteStatus(SITE_ID)).resolves.toEqual({
        connected: true,
        propertyId: '375919623',
        displayName: 'Poirier Agency',
        streamUri: 'https://poirier.agency',
      });
      expect(mockedAxios.get).not.toHaveBeenCalled();
      expect(siteRepo.update).not.toHaveBeenCalled();
    });

    it('discovers by domain on first use and persists the match on the site row', async () => {
      siteRepo.findOne.mockResolvedValue({ ...baseSite });
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            accountSummaries: [
              {
                propertySummaries: [
                  { property: 'properties/111', displayName: 'Other Site' },
                  { property: 'properties/375919623', displayName: 'Poirier Agency' },
                ],
              },
            ],
          },
        })
        // streams for properties/111 — no match
        .mockResolvedValueOnce({
          data: { dataStreams: [{ webStreamData: { defaultUri: 'https://other.example' } }] },
        })
        // streams for properties/375919623 — domain match
        .mockResolvedValueOnce({
          data: { dataStreams: [{ webStreamData: { defaultUri: 'https://poirier.agency' } }] },
        });

      const status = await service.getSiteStatus(SITE_ID);

      expect(status).toMatchObject({ connected: true, propertyId: '375919623' });
      expect(siteRepo.update).toHaveBeenCalledWith(SITE_ID, {
        ga4PropertyId: '375919623',
        ga4PropertyName: 'Poirier Agency',
        ga4StreamUri: 'https://poirier.agency',
      });
    });

    it('reports property_not_found when no stream matches the domain', async () => {
      siteRepo.findOne.mockResolvedValue({ ...baseSite });
      mockedAxios.get
        .mockResolvedValueOnce({
          data: {
            accountSummaries: [
              { propertySummaries: [{ property: 'properties/111', displayName: 'Other' }] },
            ],
          },
        })
        .mockResolvedValueOnce({
          data: { dataStreams: [{ webStreamData: { defaultUri: 'https://other.example' } }] },
        });

      await expect(service.getSiteStatus(SITE_ID)).resolves.toEqual({
        connected: false,
        reason: 'property_not_found',
      });
      expect(siteRepo.update).not.toHaveBeenCalled();
    });

    it('maps a non-auth API failure to the transient reason "error" (never a setup state)', async () => {
      siteRepo.findOne.mockResolvedValue({ ...baseSite });
      mockedAxios.get.mockRejectedValue(axiosErrorWithStatus(400));

      await expect(service.getSiteStatus(SITE_ID)).resolves.toEqual({
        connected: false,
        reason: 'error',
      });
    });
  });

  describe('discoverProperty — concurrent dedup', () => {
    it('shares one Admin API walk between parallel callers for the same domain', async () => {
      let resolveSummaries!: (v: unknown) => void;
      mockedAxios.get
        .mockImplementationOnce(
          () => new Promise((resolve) => { resolveSummaries = resolve; }),
        )
        .mockResolvedValueOnce({
          data: { dataStreams: [{ webStreamData: { defaultUri: 'https://poirier.agency' } }] },
        });

      const [a, b] = [
        service.discoverProperty('https://poirier.agency'),
        service.discoverProperty('https://poirier.agency'),
      ];
      // The walk awaits the token first — flush microtasks until the summaries request is in flight.
      while (mockedAxios.get.mock.calls.length === 0) await Promise.resolve();
      resolveSummaries({
        data: {
          accountSummaries: [
            { propertySummaries: [{ property: 'properties/375919623', displayName: 'Poirier Agency' }] },
          ],
        },
      });
      const [ra, rb] = await Promise.all([a, b]);

      expect(ra.propertyId).toBe('375919623');
      expect(rb).toEqual(ra);
      // 1× accountSummaries + 1× dataStreams — NOT doubled by the second caller.
      expect(mockedAxios.get).toHaveBeenCalledTimes(2);
    });
  });

  describe('runReportForSite — persisted-mapping invalidation', () => {
    it('clears the persisted property when the Data API answers 403, then rethrows', async () => {
      siteRepo.findOne.mockResolvedValue({
        ...baseSite,
        ga4PropertyId: '375919623',
        ga4PropertyName: 'Poirier Agency',
        ga4StreamUri: 'https://poirier.agency',
      });
      mockedAxios.post.mockRejectedValue(axiosErrorWithStatus(403));

      await expect(
        service.runReportForSite(SITE_ID, { startDate: '2026-06-01', endDate: '2026-06-30', metrics: ['sessions'] }),
      ).rejects.toThrow('GA4 report failed');
      expect(siteRepo.update).toHaveBeenCalledWith(SITE_ID, {
        ga4PropertyId: null,
        ga4PropertyName: null,
        ga4StreamUri: null,
      });
    });

    it('keeps the persisted property on a transient failure (does NOT forget on 5xx)', async () => {
      siteRepo.findOne.mockResolvedValue({
        ...baseSite,
        ga4PropertyId: '375919623',
        ga4PropertyName: 'Poirier Agency',
        ga4StreamUri: 'https://poirier.agency',
      });
      mockedAxios.post.mockRejectedValue(axiosErrorWithStatus(503));

      // Inner retry (500ms + 1500ms) runs its course, then the wrapped error surfaces.
      await expect(
        service.runReportForSite(SITE_ID, { startDate: '2026-06-01', endDate: '2026-06-30', metrics: ['sessions'] }),
      ).rejects.toThrow('GA4 report failed');
      expect(siteRepo.update).not.toHaveBeenCalledWith(SITE_ID, expect.objectContaining({ ga4PropertyId: null }));
    }, 15000);
  });

  describe('withRetry', () => {
    type WithRetry = { withRetry: <T>(fn: () => Promise<T>, delays?: number[]) => Promise<T> };

    it('retries a 429 and succeeds', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(axiosErrorWithStatus(429))
        .mockResolvedValueOnce('ok');

      await expect((service as unknown as WithRetry).withRetry(fn, [1, 1])).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('does not retry a 4xx setup error', async () => {
      const fn = jest.fn().mockRejectedValue(axiosErrorWithStatus(403));

      await expect((service as unknown as WithRetry).withRetry(fn, [1, 1])).rejects.toThrow();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('retries network errors (no response object)', async () => {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new AxiosError('ECONNRESET'))
        .mockResolvedValueOnce('ok');

      await expect((service as unknown as WithRetry).withRetry(fn, [1])).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    });
  });
});
