import { detectSitemapBroken } from './sitemap-broken.detector';
import { sitemap } from './spec-fixtures';

const SITE = 'https://example.com';

describe('detectSitemapBroken (P0 #3)', () => {
  it('healthy sitemap → no findings, evaluated', () => {
    const r = detectSitemapBroken({ sitemap: sitemap(), siteUrl: SITE });
    expect(r.findings).toHaveLength(0);
    expect(r.coverage.scopeComplete).toBe(true);
    expect(r.evaluatedSubjects).toEqual(['site']);
  });

  it('transient transport error ⇒ NOT evaluated (partial run), no finding', () => {
    const r = detectSitemapBroken({
      sitemap: sitemap({ ok: false, transportError: true, error: 'timeout of 15000ms exceeded', status: null }),
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(0);
    expect(r.coverage.scopeComplete).toBe(false);
    expect(r.coverage.subjectsErrored).toBe(1);
    expect(r.evaluatedSubjects).toEqual([]);
  });

  it('HTTP 404 ⇒ critical', () => {
    const r = detectSitemapBroken({ sitemap: sitemap({ status: 404, urlCount: null }), siteUrl: SITE });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].title).toContain('404');
  });

  it('XML parse error ⇒ critical', () => {
    const r = detectSitemapBroken({
      sitemap: sitemap({ parseError: 'Neither <urlset> nor <sitemapindex> found', urlCount: null }),
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
  });

  it('empty urlset ⇒ critical', () => {
    const r = detectSitemapBroken({ sitemap: sitemap({ urlCount: 0, hosts: [] }), siteUrl: SITE });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].title).toContain('empty');
  });

  it('all URLs on a foreign host ⇒ warning; mixed hosts do not fire', () => {
    const wrong = detectSitemapBroken({
      sitemap: sitemap({ hosts: ['staging.example.dev'] }),
      siteUrl: SITE,
    });
    expect(wrong.findings).toHaveLength(1);
    expect(wrong.findings[0].severity).toBe('warning');

    const mixed = detectSitemapBroken({
      sitemap: sitemap({ hosts: ['example.com', 'cdn.example.net'] }),
      siteUrl: SITE,
    });
    expect(mixed.findings).toHaveLength(0);
  });
});
