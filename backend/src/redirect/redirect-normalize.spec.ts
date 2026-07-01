import {
  normalizeRedirectUrl,
  extractTarget,
  parseWpDate,
  computeFingerprint,
  computeWholeSetHash,
  normalizeRedirect,
  MAPPING_VERSION,
  RawRedirect,
} from './redirect-normalize';

/** A minimal raw row with sensible defaults, overridable per test. */
function raw(over: Partial<RawRedirect> = {}): RawRedirect {
  return {
    id: 1,
    url: '/old',
    match_type: 'url',
    action_type: 'url',
    action_code: 301,
    action_data: '/new',
    match_data: null,
    regex: 0,
    group_id: 1,
    position: 0,
    status: 'enabled',
    last_access: null,
    last_count: 0,
    title: null,
    ...over,
  };
}

describe('normalizeRedirectUrl', () => {
  it('lower-cases the host and folds scheme to https', () => {
    expect(normalizeRedirectUrl('http://Example.com/Path')).toBe('https://example.com/Path');
  });

  it('KEEPS the trailing slash (significant to the matcher — never folded)', () => {
    expect(normalizeRedirectUrl('https://example.com/a/')).toBe('https://example.com/a/');
    expect(normalizeRedirectUrl('https://example.com/a')).not.toBe(
      normalizeRedirectUrl('https://example.com/a/'),
    );
  });

  it('KEEPS the query string (significant — never dropped)', () => {
    expect(normalizeRedirectUrl('https://example.com/a?x=1')).toBe('https://example.com/a?x=1');
  });

  it('does NOT drop a www subdomain (redirect targets are host-exact)', () => {
    expect(normalizeRedirectUrl('https://www.example.com/a')).toBe('https://www.example.com/a');
  });

  it('strips the default port but keeps a non-default one', () => {
    expect(normalizeRedirectUrl('https://example.com:443/a')).toBe('https://example.com/a');
    expect(normalizeRedirectUrl('http://example.com:8080/a')).toBe('https://example.com:8080/a');
  });

  it('passes a relative source through verbatim (the common case)', () => {
    expect(normalizeRedirectUrl('/old-page/')).toBe('/old-page/');
    expect(normalizeRedirectUrl('  /old-page  ')).toBe('/old-page');
  });

  it('is empty for empty/nullish input', () => {
    expect(normalizeRedirectUrl(null)).toBe('');
    expect(normalizeRedirectUrl('')).toBe('');
  });
});

describe('extractTarget', () => {
  it('reads a bare-string action_data for a url redirect', () => {
    expect(extractTarget(raw({ action_data: '/new' }))).toBe('/new');
  });

  it('reads a { url } object action_data', () => {
    expect(extractTarget(raw({ action_data: { url: '/new' } }))).toBe('/new');
  });

  it('is null for a non-url action (error/pass/etc — a 410/404 has no target)', () => {
    expect(extractTarget(raw({ action_type: 'error', action_code: 410, action_data: null }))).toBeNull();
  });

  it('is null when there is no usable url', () => {
    expect(extractTarget(raw({ action_data: null }))).toBeNull();
    expect(extractTarget(raw({ action_data: {} }))).toBeNull();
  });
});

describe('parseWpDate', () => {
  it('parses a WP UTC datetime as UTC (not local)', () => {
    expect(parseWpDate('2026-06-01 03:00:00')?.toISOString()).toBe('2026-06-01T03:00:00.000Z');
  });

  it('treats the zero sentinel / empty as null (never fired ≠ epoch)', () => {
    expect(parseWpDate('0000-00-00 00:00:00')).toBeNull();
    expect(parseWpDate('')).toBeNull();
    expect(parseWpDate(null)).toBeNull();
    expect(parseWpDate('0')).toBeNull();
  });
});

describe('computeFingerprint', () => {
  const base = {
    sourceNormalized: '/old',
    matchType: 'url',
    regex: false,
    groupId: 1,
    actionType: 'url',
    actionCode: 301,
    targetNormalized: '/new',
    mappingVersion: MAPPING_VERSION,
  };

  it('is stable for identical content', () => {
    expect(computeFingerprint(base)).toBe(computeFingerprint({ ...base }));
  });

  it('changes when the target changes', () => {
    expect(computeFingerprint(base)).not.toBe(
      computeFingerprint({ ...base, targetNormalized: '/other' }),
    );
  });

  it('changes when the status code changes (301 → 302)', () => {
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, actionCode: 302 }));
  });

  it('distinguishes two rules on the same source by match_type / regex', () => {
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, regex: true }));
    expect(computeFingerprint(base)).not.toBe(computeFingerprint({ ...base, matchType: 'referrer' }));
  });
});

describe('computeWholeSetHash', () => {
  it('is order-independent (plugin re-ordering alone is not a change)', () => {
    expect(computeWholeSetHash(['a', 'b', 'c'])).toBe(computeWholeSetHash(['c', 'a', 'b']));
  });

  it('changes when the set membership changes', () => {
    expect(computeWholeSetHash(['a', 'b'])).not.toBe(computeWholeSetHash(['a', 'b', 'c']));
  });
});

describe('normalizeRedirect', () => {
  it('maps the core fields and derives enabled/regex/target', () => {
    const n = normalizeRedirect(
      raw({
        id: 7,
        url: '/old-page',
        action_data: '/new-page',
        action_code: 301,
        regex: 0,
        status: 'enabled',
        last_count: 42,
      }),
    );
    expect(n.pluginId).toBe(7);
    expect(n.source).toBe('/old-page');
    expect(n.target).toBe('/new-page');
    expect(n.actionCode).toBe(301);
    expect(n.regex).toBe(false);
    expect(n.enabled).toBe(true);
    expect(n.wpLastCount).toBe(42);
    expect(n.fingerprint).toHaveLength(64);
    expect(n.mappingVersion).toBe(MAPPING_VERSION);
  });

  it('marks a disabled redirect as not enabled', () => {
    expect(normalizeRedirect(raw({ status: 'disabled' })).enabled).toBe(false);
  });

  it('marks a regex redirect', () => {
    expect(normalizeRedirect(raw({ regex: 1 })).regex).toBe(true);
  });

  it('has a null target for a 410 (Gone) redirect', () => {
    const n = normalizeRedirect(raw({ action_type: 'error', action_code: 410, action_data: null }));
    expect(n.target).toBeNull();
    expect(n.targetNormalized).toBeNull();
    expect(n.actionCode).toBe(410);
  });

  it('same content but re-ordered position ⇒ same fingerprint (position is not identity)', () => {
    const a = normalizeRedirect(raw({ position: 0 }));
    const b = normalizeRedirect(raw({ position: 99 }));
    expect(a.fingerprint).toBe(b.fingerprint);
  });
});
