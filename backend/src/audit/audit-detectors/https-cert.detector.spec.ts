import { detectHttpsRegression } from './https-cert.detector';
import { head, httpsSignal, page } from './spec-fixtures';

const SITE = 'https://example.com';

describe('detectHttpsRegression (P0 #6 — three axes, one stable finding each)', () => {
  it('healthy site → no findings, all axes evaluated', () => {
    const r = detectHttpsRegression({
      https: httpsSignal(),
      pages: [page(`${SITE}/a`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(0);
    expect(r.coverage.scopeComplete).toBe(true);
    expect(r.evaluatedSubjects).toEqual(['site']);
  });

  it('expired cert ⇒ critical; expiring in ≤14 days ⇒ warning', () => {
    const expired = detectHttpsRegression({
      https: httpsSignal({ cert: { daysRemaining: -2, authorized: false, error: 'certificate has expired' } }),
      pages: [page(`${SITE}/a`)],
      siteUrl: SITE,
    });
    expect(expired.findings).toHaveLength(1);
    expect(expired.findings[0].discriminator).toBe('cert');
    expect(expired.findings[0].severity).toBe('critical');
    expect(expired.findings[0].title).toContain('EXPIRED');

    const expiring = detectHttpsRegression({
      https: httpsSignal({ cert: { daysRemaining: 9 } }),
      pages: [page(`${SITE}/a`)],
      siteUrl: SITE,
    });
    expect(expiring.findings).toHaveLength(1);
    expect(expiring.findings[0].severity).toBe('warning');
    expect(expiring.findings[0].title).toContain('9 days');
  });

  it('untrusted chain (authorized=false, not expired) ⇒ critical', () => {
    const r = detectHttpsRegression({
      https: httpsSignal({ cert: { authorized: false, error: 'unable to verify the first certificate' } }),
      pages: [page(`${SITE}/a`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].title).toContain('not trusted');
  });

  it('http:// serving 200 (no redirect to HTTPS) ⇒ critical', () => {
    const r = detectHttpsRegression({
      https: httpsSignal({ http: { status: 200, redirectsToHttps: false, location: null } }),
      pages: [page(`${SITE}/a`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].discriminator).toBe('http_not_redirecting');
  });

  it('port 80 unreachable is acceptable config — not a finding', () => {
    const r = detectHttpsRegression({
      https: httpsSignal({ http: { ok: false, status: null, error: 'ECONNREFUSED', redirectsToHttps: null, location: null } }),
      pages: [page(`${SITE}/a`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(0);
    expect(r.coverage.scopeComplete).toBe(true);
  });

  it('SITEWIDE mixed content fires; a few pages below threshold do not', () => {
    const dirty = Array.from({ length: 12 }, (_, i) =>
      page(`${SITE}/p${i}`, { head: head({ httpAssets: ['http://cdn.example.com/x.js'] }) }));
    const clean = Array.from({ length: 8 }, (_, i) => page(`${SITE}/c${i}`));
    const r = detectHttpsRegression({ https: httpsSignal(), pages: [...dirty, ...clean], siteUrl: SITE });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].discriminator).toBe('mixed_content');
    expect(r.findings[0].evidence.pagesWithMixedContent).toBe(12);

    const few = detectHttpsRegression({
      https: httpsSignal(),
      pages: [...dirty.slice(0, 3), ...clean, ...Array.from({ length: 20 }, (_, i) => page(`${SITE}/d${i}`))],
      siteUrl: SITE,
    });
    expect(few.findings).toHaveLength(0);
  });

  it('an uninspectable cert makes the pass conservative: no site-level resolves', () => {
    const r = detectHttpsRegression({
      https: httpsSignal({ cert: { authorized: null, validTo: null, daysRemaining: null, issuer: null, error: 'ECONNRESET' }, https: { ok: false, status: null, error: 'ECONNRESET' } }),
      pages: [page(`${SITE}/a`)],
      siteUrl: SITE,
    });
    expect(r.coverage.scopeComplete).toBe(false);
    expect(r.evaluatedSubjects).toEqual([]); // open https findings stay unconfirmed
  });
});
