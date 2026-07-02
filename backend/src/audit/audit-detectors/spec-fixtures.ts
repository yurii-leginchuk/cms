import { GscWindow, HttpsSignal, LiveProbeSignal, NotFoundProbeSignal, PageSignal, RobotsSignal, SitemapSignal } from './detector-types';
import { HeadSignal } from '../audit-head';
import { normalizeAuditUrl } from '../audit-fingerprint';

/** Shared detector-spec fixture builders (not a spec file itself). */

export const WINDOW: GscWindow = {
  from: '2026-06-01',
  to: '2026-06-28',
  timezone: 'America/Los_Angeles',
};

export function head(overrides: Partial<HeadSignal> = {}): HeadSignal {
  return {
    title: 'A fine page',
    robotsMeta: null,
    robotsNoindex: false,
    canonical: null,
    httpAssets: [],
    hreflangCount: 0,
    ...overrides,
  };
}

export function page(url: string, overrides: Partial<PageSignal> = {}): PageSignal {
  return {
    pageId: `pid-${url.replace(/\W+/g, '-')}`,
    url,
    subjectKey: normalizeAuditUrl(url),
    head: head(),
    intentDirective: 'default',
    cmsCanonical: null,
    isTransactional: false,
    missingFromSitemapAt: null,
    lastScrapedAt: '2026-07-01T02:00:00.000Z',
    wordCount: 500,
    crawl: null,
    gscClicks: null,
    gscImpressions: null,
    live: null,
    ...overrides,
  };
}

export function live(overrides: Partial<LiveProbeSignal> = {}): LiveProbeSignal {
  return {
    url: 'https://example.com/x',
    fetchedAt: '2026-07-02T09:00:00.000Z',
    ok: true,
    error: null,
    timedOut: false,
    status: 200,
    finalStatus: 200,
    finalUrl: 'https://example.com/x',
    redirectChain: [],
    xRobotsTag: null,
    head: head(),
    contentLength: 12345,
    ...overrides,
  };
}

export function robots(overrides: Partial<RobotsSignal> = {}): RobotsSignal {
  return {
    url: 'https://example.com/robots.txt',
    fetchedAt: '2026-07-02T09:00:00.000Z',
    ok: true,
    error: null,
    timedOut: false,
    status: 200,
    content: 'User-agent: *\nDisallow:\n',
    ...overrides,
  };
}

export function sitemap(overrides: Partial<SitemapSignal> = {}): SitemapSignal {
  return {
    url: 'https://example.com/sitemap.xml',
    fetchedAt: '2026-07-02T09:00:00.000Z',
    ok: true,
    error: null,
    transportError: false,
    status: 200,
    urlCount: 42,
    parseError: null,
    hosts: ['example.com'],
    fetchesUsed: 1,
    ...overrides,
  };
}

export function httpsSignal(overrides: {
  https?: Partial<HttpsSignal['https']>;
  cert?: Partial<HttpsSignal['cert']>;
  http?: Partial<HttpsSignal['http']>;
} = {}): HttpsSignal {
  return {
    fetchedAt: '2026-07-02T09:00:00.000Z',
    https: { ok: true, status: 200, error: null, ...overrides.https },
    cert: {
      authorized: true,
      validTo: 'Dec 31 23:59:59 2026 GMT',
      daysRemaining: 180,
      issuer: "Let's Encrypt",
      error: null,
      ...overrides.cert,
    },
    http: {
      ok: true,
      status: 301,
      redirectsToHttps: true,
      location: 'https://example.com/',
      error: null,
      ...overrides.http,
    },
  };
}

export function probe404(overrides: Partial<NotFoundProbeSignal> = {}): NotFoundProbeSignal {
  return {
    probeUrl: 'https://example.com/cms-audit-404-probe-1',
    fetchedAt: '2026-07-02T09:00:00.000Z',
    ok: true,
    error: null,
    status: 404,
    title: 'Page not found – Example',
    contentLength: 4000,
    ...overrides,
  };
}
