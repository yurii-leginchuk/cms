import { detectSoft404Suspect } from './soft-404.detector';
import { WINDOW, head, page, probe404 } from './spec-fixtures';

const SITE = 'https://example.com';

describe('detectSoft404Suspect (P0 #5 — always a suspicion, never critical)', () => {
  it("fires on Google's own SOFT_404 verdict (crawl module cross-check)", () => {
    const p = page(`${SITE}/ghost`, {
      gscClicks: 30,
      crawl: { derivedStatus: 'soft_404', pageFetchState: 'SOFT_404', googleCanonical: null },
    });
    const r = detectSoft404Suspect([p], probe404(), WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('warning');
    expect(r.findings[0].evidence.reasons).toContain('google_soft_404_verdict');
  });

  it('fires when the page title equals the calibrated 404-template title', () => {
    const p = page(`${SITE}/ghost`, {
      isTransactional: true,
      head: head({ title: 'Page not found – Example' }),
    });
    const r = detectSoft404Suspect([p], probe404({ title: 'Page not found – Example' }), WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].evidence.reasons).toContain('title_matches_404_template');
  });

  it('fires on a generic not-found title pattern', () => {
    const p = page(`${SITE}/ghost`, {
      gscClicks: 5,
      head: head({ title: 'Error 404 - nothing here' }),
    });
    const r = detectSoft404Suspect([p], null, WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].evidence.reasons).toContain('title_looks_not_found');
  });

  it('thin content ALONE is not enough (too noisy)', () => {
    const p = page(`${SITE}/thin`, { gscClicks: 5, wordCount: 12 });
    const r = detectSoft404Suspect([p], probe404(), WINDOW);
    expect(r.findings).toHaveLength(0);
  });

  it('non-trafficked pages are not subjects; tombstoned pages excluded', () => {
    const quiet = page(`${SITE}/quiet`, { head: head({ title: '404 Error' }) });
    const gone = page(`${SITE}/gone`, {
      gscClicks: 10,
      head: head({ title: '404 Error' }),
      missingFromSitemapAt: '2026-06-01T00:00:00.000Z',
    });
    const r = detectSoft404Suspect([quiet, gone], null, WINDOW);
    expect(r.coverage.subjectsSelected).toBe(0);
    expect(r.findings).toHaveLength(0);
  });

  it('a failed probe means no template calibration but the other signals still work', () => {
    const p = page(`${SITE}/ghost`, {
      gscClicks: 3,
      head: head({ title: 'Page not found' }),
    });
    const r = detectSoft404Suspect([p], probe404({ ok: false, error: 'timeout', title: null, status: null }), WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].evidence.probeTitle).toBeNull();
  });
});
