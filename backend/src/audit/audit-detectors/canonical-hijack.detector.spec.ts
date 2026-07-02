import { detectCanonicalHijack } from './canonical-hijack.detector';
import { WINDOW, head, page } from './spec-fixtures';

const SITE = 'https://example.com';

describe('detectCanonicalHijack (P0 #7)', () => {
  it('self-canonical (any spelling) is fine — scheme/www/slash folded first', () => {
    const p = page(`${SITE}/pricing`, {
      head: head({ canonical: 'http://www.example.com/pricing/' }),
    });
    const r = detectCanonicalHijack([p], SITE, WINDOW);
    expect(r.findings).toHaveLength(0);
    expect(r.evaluatedSubjects).toContain(p.subjectKey);
  });

  it('off-site canonical fires (critical on a money page, warning otherwise)', () => {
    const money = page(`${SITE}/pricing`, {
      isTransactional: true,
      head: head({ canonical: 'https://competitor.net/pricing' }),
    });
    const quiet = page(`${SITE}/blog`, {
      head: head({ canonical: 'https://competitor.net/blog' }),
    });
    const r = detectCanonicalHijack([money, quiet], SITE, WINDOW);
    expect(r.findings).toHaveLength(2);
    const bySubject = new Map(r.findings.map((f) => [f.subjectKey, f]));
    expect(bySubject.get(money.subjectKey)!.severity).toBe('critical');
    expect(bySubject.get(quiet.subjectKey)!.severity).toBe('warning');
    expect(bySubject.get(money.subjectKey)!.evidence.kind).toBe('offsite');
  });

  it('CMS-intended canonical (meta editor) is configuration — silence', () => {
    const p = page(`${SITE}/syndicated`, {
      head: head({ canonical: 'https://partner.com/original-article' }),
      cmsCanonical: 'https://partner.com/original-article/',
    });
    const r = detectCanonicalHijack([p], SITE, WINDOW);
    expect(r.findings).toHaveLength(0);
  });

  it('canonical pointing at the homepage from a non-home page fires', () => {
    const p = page(`${SITE}/services/pool-repair`, {
      gscClicks: 88,
      head: head({ canonical: 'https://www.example.com/' }),
    });
    const r = detectCanonicalHijack([p], SITE, WINDOW);
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].evidence.kind).toBe('homepage');
    expect(r.findings[0].severity).toBe('critical'); // has clicks → money page
  });

  it('the homepage self-canonical does not fire', () => {
    const home = page(`${SITE}/`, { head: head({ canonical: `${SITE}/` }) });
    const r = detectCanonicalHijack([home], SITE, WINDOW);
    expect(r.findings).toHaveLength(0);
  });

  it('on-site non-self canonical is dedupe config, not a hijack', () => {
    const p = page(`${SITE}/pricing?utm=x`, {
      head: head({ canonical: `${SITE}/pricing` }),
    });
    const r = detectCanonicalHijack([p], SITE, WINDOW);
    expect(r.findings).toHaveLength(0);
  });

  it('no canonical tag at all is not this detector’s business', () => {
    const p = page(`${SITE}/plain`, { head: head({ canonical: null }) });
    const r = detectCanonicalHijack([p], SITE, WINDOW);
    expect(r.findings).toHaveLength(0);
  });

  it('missing rawHtml degrades coverage honestly', () => {
    const p = page(`${SITE}/unparsed`, { head: null });
    const r = detectCanonicalHijack([p], SITE, WINDOW);
    expect(r.coverage.subjectsErrored).toBe(1);
    expect(r.coverage.scopeComplete).toBe(false);
  });
});
