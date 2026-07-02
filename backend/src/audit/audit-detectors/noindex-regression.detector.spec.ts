import { detectNoindexRegression } from './noindex-regression.detector';
import { WINDOW, head, live, page } from './spec-fixtures';

describe('detectNoindexRegression (P0 #1)', () => {
  it('fires when an indexable page shows noindex in the stored parse', () => {
    const p = page('https://example.com/pricing', {
      head: head({ robotsMeta: 'noindex, follow', robotsNoindex: true }),
      gscClicks: 412,
    });
    const r = detectNoindexRegression([p], WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].subjectKey).toBe('https://example.com/pricing');
    expect(r.findings[0].title).toContain('/pricing');
    expect(r.findings[0].evidence.robotsMeta).toBe('noindex, follow');
    expect(r.findings[0].evidence.gscClicks).toBe(412);
    expect(r.coverage.scopeComplete).toBe(true);
  });

  it('intentional noindex is configuration, never an alert', () => {
    const p = page('https://example.com/internal', {
      head: head({ robotsNoindex: true }),
      intentDirective: 'noindex',
    });
    const r = detectNoindexRegression([p], WINDOW);
    expect(r.findings).toHaveLength(0);
    expect(r.evaluatedSubjects).toContain(p.subjectKey);
  });

  it('a completed live re-check overrides a stale stored parse (no finding)', () => {
    const p = page('https://example.com/fixed', {
      head: head({ robotsNoindex: true }),
      live: live({ head: head({ robotsNoindex: false }), xRobotsTag: null }),
    });
    const r = detectNoindexRegression([p], WINDOW);
    expect(r.findings).toHaveLength(0);
  });

  it('fires on a live X-Robots-Tag noindex even when the meta is clean', () => {
    const p = page('https://example.com/header-noindex', {
      head: head({ robotsNoindex: false }),
      live: live({ head: head({ robotsNoindex: false }), xRobotsTag: 'noindex, nofollow' }),
    });
    const r = detectNoindexRegression([p], WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].evidence.xRobotsTag).toBe('noindex, nofollow');
  });

  it('tombstoned pages are out of scope; missing rawHtml degrades coverage honestly', () => {
    const gone = page('https://example.com/gone', {
      head: head({ robotsNoindex: true }),
      missingFromSitemapAt: '2026-06-20T00:00:00.000Z',
    });
    const unparsed = page('https://example.com/unparsed', { head: null });
    const r = detectNoindexRegression([gone, unparsed], WINDOW);
    expect(r.findings).toHaveLength(0);
    expect(r.coverage.subjectsSelected).toBe(1); // only /unparsed
    expect(r.coverage.subjectsEvaluated).toBe(0);
    expect(r.coverage.subjectsErrored).toBe(1);
    expect(r.coverage.scopeComplete).toBe(false); // 0 of 1 evaluated
  });

  it('fix route deep-links the Meta editor for the page', () => {
    const p = page('https://example.com/pricing', {
      head: head({ robotsNoindex: true }),
    });
    const r = detectNoindexRegression([p], WINDOW);
    expect(r.findings[0].fixRoute).toBe(`/sites/{siteId}/meta/${p.pageId}`);
  });
});
