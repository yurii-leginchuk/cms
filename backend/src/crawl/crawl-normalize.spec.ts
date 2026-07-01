import {
  deriveStatus,
  canonicalMismatch,
  normalizeUrlForCompare,
  normalizeInspection,
  computeStateHash,
  coverageWithDenominator,
  MAPPING_VERSION,
  IndexStatusResult,
} from './crawl-normalize';

describe('deriveStatus', () => {
  const cases: Array<[string, string, boolean | null]> = [
    ['Submitted and indexed', 'indexed', true],
    ['Indexed, not submitted in sitemap', 'indexed', true],
    ['Crawled - currently not indexed', 'crawled_not_indexed', false],
    ['Discovered - currently not indexed', 'discovered_not_indexed', false],
    ['Alternate page with proper canonical tag', 'canonical_alternate', false],
    ['Duplicate without user-selected canonical', 'canonical_alternate', false],
    ["Excluded by 'noindex' tag", 'excluded_noindex', false],
    ['Blocked by robots.txt', 'blocked_robots', false],
    ['Page with redirect', 'redirect', false],
    ['Not found (404)', 'not_found', false],
    ['Soft 404', 'soft_404', false],
    ['URL is unknown to Google', 'unknown_to_google', false],
  ];

  it.each(cases)('maps coverageState "%s" → %s / indexed=%s', (coverageState, status, isIndexed) => {
    const out = deriveStatus({ coverageState });
    expect(out.status).toBe(status);
    expect(out.isIndexed).toBe(isIndexed);
  });

  it('tolerates smart quotes and spacing in coverageState', () => {
    const out = deriveStatus({ coverageState: 'Excluded by ‘noindex’ tag' });
    expect(out.status).toBe('excluded_noindex');
    expect(out.isIndexed).toBe(false);
  });

  it('fails LOUD on an unrecognised coverageState (never silent not-indexed)', () => {
    const out = deriveStatus({ coverageState: 'Some brand new Google state 2027' });
    expect(out.status).toBe('unknown');
    expect(out.isIndexed).toBeNull();
  });

  it('falls back to pageFetchState enums when coverageState is absent', () => {
    expect(deriveStatus({ pageFetchState: 'NOT_FOUND' }).status).toBe('not_found');
    expect(deriveStatus({ pageFetchState: 'SOFT_404' }).status).toBe('soft_404');
    expect(deriveStatus({ pageFetchState: 'SERVER_ERROR' }).status).toBe('server_error');
    expect(deriveStatus({ indexingState: 'BLOCKED_BY_META_TAG' }).status).toBe('excluded_noindex');
  });

  it('does NOT derive indexed from verdict===PASS alone', () => {
    // verdict PASS but no/odd coverageState must not be called "indexed".
    const out = deriveStatus({ verdict: 'PASS', coverageState: 'Totally unknown string' });
    expect(out.status).toBe('unknown');
    expect(out.isIndexed).toBeNull();
  });
});

describe('normalizeUrlForCompare / canonicalMismatch', () => {
  it('folds scheme, www, trailing slash and case', () => {
    expect(normalizeUrlForCompare('http://www.Example.com/Path/')).toBe('https://example.com/Path');
  });

  it('treats http/https + www + slash variants of the same URL as no conflict', () => {
    expect(canonicalMismatch('https://example.com/a', 'http://www.example.com/a/')).toBe(false);
  });

  it('flags a genuinely different canonical', () => {
    expect(canonicalMismatch('https://example.com/gutter-guide', 'https://example.com/blog/gutters')).toBe(true);
  });

  it('a missing side is not a conflict (insufficient info, not a clash)', () => {
    expect(canonicalMismatch(null, 'https://example.com/a')).toBe(false);
    expect(canonicalMismatch('https://example.com/a', undefined)).toBe(false);
  });
});

describe('computeStateHash', () => {
  const base = {
    derivedStatus: 'indexed' as const,
    verdict: 'PASS',
    coverageStateRaw: 'Submitted and indexed',
    robotsTxtState: 'ALLOWED',
    indexingState: 'INDEXING_ALLOWED',
    pageFetchState: 'SUCCESSFUL',
    crawledAs: 'MOBILE',
    googleCanonical: 'https://example.com/a',
    userCanonical: 'https://example.com/a',
    canonicalConflict: false,
    mappingVersion: MAPPING_VERSION,
  };

  it('is stable for identical state', () => {
    expect(computeStateHash(base)).toBe(computeStateHash({ ...base }));
  });

  it('changes when the derived status changes', () => {
    expect(computeStateHash(base)).not.toBe(
      computeStateHash({ ...base, derivedStatus: 'crawled_not_indexed', coverageStateRaw: 'Crawled - currently not indexed' }),
    );
  });
});

describe('normalizeInspection', () => {
  const indexed: IndexStatusResult = {
    verdict: 'PASS',
    coverageState: 'Submitted and indexed',
    robotsTxtState: 'ALLOWED',
    indexingState: 'INDEXING_ALLOWED',
    pageFetchState: 'SUCCESSFUL',
    crawledAs: 'MOBILE',
    googleCanonical: 'https://example.com/a',
    userCanonical: 'https://example.com/a',
    lastCrawlTime: '2026-06-01T03:00:00Z',
  };

  it('keeps raw enums verbatim and derives status', () => {
    const n = normalizeInspection(indexed);
    expect(n.derivedStatus).toBe('indexed');
    expect(n.isIndexed).toBe(true);
    expect(n.coverageStateRaw).toBe('Submitted and indexed');
    expect(n.crawledAs).toBe('MOBILE');
    expect(n.googleLastCrawlTime?.toISOString()).toBe('2026-06-01T03:00:00.000Z');
    expect(n.mappingVersion).toBe(MAPPING_VERSION);
  });

  it('stateHash is UNCHANGED when only lastCrawlTime differs (a fresh crawl ≠ a change)', () => {
    const a = normalizeInspection(indexed);
    const b = normalizeInspection({ ...indexed, lastCrawlTime: '2026-06-20T09:00:00Z' });
    expect(a.stateHash).toBe(b.stateHash);
  });

  it('stateHash DOES change on a real coverage transition', () => {
    const a = normalizeInspection(indexed);
    const b = normalizeInspection({ ...indexed, coverageState: 'Crawled - currently not indexed', verdict: 'NEUTRAL' });
    expect(a.stateHash).not.toBe(b.stateHash);
  });

  it('detects a canonical conflict', () => {
    const n = normalizeInspection({ ...indexed, googleCanonical: 'https://example.com/other' });
    expect(n.canonicalConflict).toBe(true);
  });
});

describe('coverageWithDenominator', () => {
  it('separates never-checked from inspected and keeps the denominator', () => {
    const s = coverageWithDenominator([
      { isIndexed: true, derivedStatus: 'indexed' },
      { isIndexed: false, derivedStatus: 'crawled_not_indexed' },
      { isIndexed: null, derivedStatus: 'unknown' },
      { isIndexed: null, derivedStatus: null }, // never checked
    ]);
    expect(s.total).toBe(4);
    expect(s.inspected).toBe(3);
    expect(s.neverChecked).toBe(1);
    expect(s.indexed).toBe(1);
    expect(s.notIndexed).toBe(1);
    expect(s.unknown).toBe(1);
    expect(s.byStatus.indexed).toBe(1);
  });
});
