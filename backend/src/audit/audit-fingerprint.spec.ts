import {
  FINGERPRINT_VERSION,
  SITE_SUBJECT,
  auditHost,
  findingFingerprint,
  normalizeAuditUrl,
  scopeSignature,
  snapshotFingerprint,
} from './audit-fingerprint';

describe('normalizeAuditUrl (identity normalization, v1 frozen)', () => {
  it('folds scheme, www, default port, fragment and trailing slash', () => {
    expect(normalizeAuditUrl('http://WWW.Example.com:80/pricing/#top')).toBe('https://example.com/pricing');
    expect(normalizeAuditUrl('https://example.com:443/pricing/')).toBe('https://example.com/pricing');
    expect(normalizeAuditUrl('https://www.example.com/pricing')).toBe('https://example.com/pricing');
  });

  it('keeps root slash, path case and query string', () => {
    expect(normalizeAuditUrl('https://example.com/')).toBe('https://example.com/');
    expect(normalizeAuditUrl('https://example.com/Pricing?b=2')).toBe('https://example.com/Pricing?b=2');
  });

  it('keeps a non-default port', () => {
    expect(normalizeAuditUrl('https://example.com:8443/x')).toBe('https://example.com:8443/x');
  });

  it('returns unparseable / relative input trimmed but stable', () => {
    expect(normalizeAuditUrl('  /old-page ')).toBe('/old-page');
    expect(normalizeAuditUrl('')).toBe('');
    expect(normalizeAuditUrl(null)).toBe('');
  });

  it('two spellings of the same page yield the SAME subject key', () => {
    const a = normalizeAuditUrl('http://www.example.com/pricing/');
    const b = normalizeAuditUrl('https://example.com/pricing');
    expect(a).toBe(b);
  });
});

describe('auditHost', () => {
  it('lower-cases and strips www', () => {
    expect(auditHost('https://WWW.Example.COM/x')).toBe('example.com');
  });
  it('null for garbage', () => {
    expect(auditHost('not a url')).toBeNull();
    expect(auditHost(null)).toBeNull();
  });
});

describe('findingFingerprint (identity = subject, never observed value)', () => {
  it('is stable for identical inputs', () => {
    const a = findingFingerprint('noindex_regression', 'https://example.com/pricing');
    const b = findingFingerprint('noindex_regression', 'https://example.com/pricing');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('differs across checkTypes for the same subject', () => {
    const a = findingFingerprint('noindex_regression', 'https://example.com/p');
    const b = findingFingerprint('canonical_hijack', 'https://example.com/p');
    expect(a).not.toBe(b);
  });

  it('discriminator separates https axes on the same site subject', () => {
    const cert = findingFingerprint('https_regression', SITE_SUBJECT, 'cert');
    const mixed = findingFingerprint('https_regression', SITE_SUBJECT, 'mixed_content');
    const plain = findingFingerprint('https_regression', SITE_SUBJECT);
    expect(new Set([cert, mixed, plain]).size).toBe(3);
  });

  it('one finding per robots rule (rule = discriminator)', () => {
    const a = findingFingerprint('robots_txt_regression', SITE_SUBJECT, '/checkout');
    const b = findingFingerprint('robots_txt_regression', SITE_SUBJECT, '/cart');
    expect(a).not.toBe(b);
  });
});

describe('snapshotFingerprint', () => {
  it('never collides with a real finding fingerprint on the same subject', () => {
    const snap = snapshotFingerprint('robots_txt_regression');
    const unreachable = findingFingerprint('robots_txt_regression', SITE_SUBJECT, 'unreachable');
    const rule = findingFingerprint('robots_txt_regression', SITE_SUBJECT, '/checkout');
    expect(snap).not.toBe(unreachable);
    expect(snap).not.toBe(rule);
  });
});

describe('scopeSignature (trend-discontinuity guard)', () => {
  it('is deterministic and changes when the scope changes', () => {
    const base = { selectionRule: 'full_inventory_v1', pagesTotal: 214, moneyPages: 12, fingerprintVersion: FINGERPRINT_VERSION };
    expect(scopeSignature(base)).toBe(scopeSignature({ ...base }));
    expect(scopeSignature(base)).not.toBe(scopeSignature({ ...base, pagesTotal: 215 }));
    expect(scopeSignature(base)).not.toBe(scopeSignature({ ...base, selectionRule: 'v2' }));
  });
});
