import { detectMoneyPageRegression } from './money-page.detector';
import { WINDOW, live, page } from './spec-fixtures';

const SITE = 'https://example.com';

describe('detectMoneyPageRegression (P0 #4)', () => {
  it('a money page returning 404 live fires critical', () => {
    const p = page(`${SITE}/pricing`, {
      isTransactional: true,
      gscClicks: 412,
      live: live({ status: 404, finalStatus: 404 }),
    });
    const r = detectMoneyPageRegression([p], WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].evidence.finalStatus).toBe(404);
    expect(r.findings[0].fixRoute).toBe('/sites/{siteId}/redirects');
  });

  it('a covering 301 → 200 is intentional retirement — SILENCE', () => {
    const p = page(`${SITE}/old-offer`, {
      gscClicks: 50,
      missingFromSitemapAt: '2026-06-25T00:00:00.000Z',
      live: live({
        status: 301,
        finalStatus: 200,
        finalUrl: `${SITE}/new-offer`,
        redirectChain: [{ status: 301, location: `${SITE}/new-offer` }],
      }),
    });
    const r = detectMoneyPageRegression([p], WINDOW);
    expect(r.findings).toHaveLength(0);
    expect(r.evaluatedSubjects).toContain(p.subjectKey);
  });

  it('a redirect ending on a dead page is still critical', () => {
    const p = page(`${SITE}/old-offer`, {
      isTransactional: true,
      live: live({
        status: 301,
        finalStatus: 404,
        finalUrl: `${SITE}/nowhere`,
        redirectChain: [{ status: 301, location: `${SITE}/nowhere` }],
      }),
    });
    const r = detectMoneyPageRegression([p], WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].title).toContain('dead end');
  });

  it('live 200 but dropped from the sitemap fires warning', () => {
    const p = page(`${SITE}/pricing`, {
      isTransactional: true,
      missingFromSitemapAt: '2026-06-30T00:00:00.000Z',
      live: live({ status: 200, finalStatus: 200 }),
    });
    const r = detectMoneyPageRegression([p], WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('warning');
    expect(r.findings[0].title).toContain('sitemap');
  });

  it('non-money pages are not subjects at all', () => {
    const p = page(`${SITE}/blog-post`, { live: live({ status: 404, finalStatus: 404 }) });
    const r = detectMoneyPageRegression([p], WINDOW);
    expect(r.findings).toHaveLength(0);
    expect(r.coverage.subjectsSelected).toBe(0);
  });

  it('budget-cut probes ⇒ scopeComplete=false; probe errors counted honestly', () => {
    const probed = page(`${SITE}/a`, { isTransactional: true, live: live() });
    const notProbed = page(`${SITE}/b`, { isTransactional: true, live: null });
    const failed = page(`${SITE}/c`, {
      isTransactional: true,
      live: live({ ok: false, timedOut: true, error: 'timeout', status: null, finalStatus: null }),
    });
    const r = detectMoneyPageRegression([probed, notProbed, failed], WINDOW);
    expect(r.coverage.subjectsSelected).toBe(3);
    expect(r.coverage.subjectsEvaluated).toBe(1);
    expect(r.coverage.subjectsTimedOut).toBe(1);
    expect(r.coverage.scopeComplete).toBe(false);
    expect(r.evaluatedSubjects).toEqual([probed.subjectKey]);
  });
});
