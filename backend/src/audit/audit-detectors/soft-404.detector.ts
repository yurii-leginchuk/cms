import { DetectorResult, GscWindow, NotFoundProbeSignal, PageSignal, RawFinding, isMoneyPage, pathOf } from './detector-types';
import { titleLooks404 } from '../audit-head';

/**
 * P0 #5 — Soft-404 SUSPICION on trafficked pages: the page serves 200 but its
 * content looks like an error template. Heuristic by nature, so it is always
 * labeled a suspicion and capped at `warning` — never a hard critical alert.
 *
 * Signals, strongest first:
 *  1. Google's own verdict — `crawl_page_status.pageFetchState = SOFT_404`
 *     (consumed from the crawl module, never recomputed).
 *  2. Page <title> equals the site's real 404 template title (calibrated by
 *     the guaranteed-nonexistent-URL probe this run).
 *  3. Page <title> matches common not-found patterns.
 * Thin content alone (low word count) is deliberately NOT enough — too noisy.
 */
export const SOFT_404_VERSION = 1;

export function detectSoft404Suspect(
  pages: PageSignal[],
  probe: NotFoundProbeSignal | null,
  gscWindow: GscWindow | null,
): DetectorResult {
  const findings: RawFinding[] = [];
  const evaluatedSubjects: string[] = [];
  let errored = 0;

  // The 404-template title is only usable for matching when the probe worked
  // AND the site actually soft-404s (a real 404/410 template title can legally
  // appear nowhere else, but a 200-probe title is the smoking-gun template).
  const probeTitle = probe?.ok && probe.title ? probe.title.trim() : null;

  // Subjects: trafficked pages still in the sitemap.
  const subjects = pages.filter((p) => p.missingFromSitemapAt == null && isMoneyPage(p));

  for (const p of subjects) {
    if (!p.head) {
      errored += 1;
      continue;
    }
    evaluatedSubjects.push(p.subjectKey);

    const title = p.head.title;
    const googleSoft404 = p.crawl?.pageFetchState === 'SOFT_404'
      || p.crawl?.derivedStatus === 'soft_404';
    const titleEqualsProbe = probeTitle != null && title != null && title.trim() === probeTitle;
    const titlePattern = titleLooks404(title);

    if (!googleSoft404 && !titleEqualsProbe && !titlePattern) continue;

    const reasons: string[] = [];
    if (googleSoft404) reasons.push('google_soft_404_verdict');
    if (titleEqualsProbe) reasons.push('title_matches_404_template');
    if (titlePattern) reasons.push('title_looks_not_found');

    findings.push({
      checkType: 'soft_404_suspect',
      subjectKey: p.subjectKey,
      severity: 'warning', // suspicion, never critical
      title: `Soft-404 suspicion on ${pathOf(p.url)}`,
      evidence: {
        url: p.url,
        pageTitle: title,
        probeTitle,
        reasons,
        wordCount: p.wordCount,
        crawlPageFetchState: p.crawl?.pageFetchState ?? null,
        crawlDerivedStatus: p.crawl?.derivedStatus ?? null,
        gscClicks: p.gscClicks,
        gscImpressions: p.gscImpressions,
        gscWindow,
        lastScrapedAt: p.lastScrapedAt,
        note: 'Heuristic suspicion — verify by opening the page. Google silently drops soft-404 pages.',
      },
      affectedUrls: [{ url: p.url, pageId: p.pageId }],
      fixRoute: `/sites/{siteId}/index-status`,
      rawSignal: {
        pageTitle: title,
        probeTitle,
        reasons,
        wordCount: p.wordCount,
        crawlPageFetchState: p.crawl?.pageFetchState ?? null,
      },
    });
  }

  return {
    checkType: 'soft_404_suspect',
    version: SOFT_404_VERSION,
    findings,
    coverage: {
      subjectsSelected: subjects.length,
      subjectsEvaluated: evaluatedSubjects.length,
      subjectsErrored: errored,
      subjectsTimedOut: 0,
      scopeComplete: evaluatedSubjects.length === subjects.length,
    },
    evaluatedSubjects,
  };
}
