import { DetectorResult, GscWindow, PageSignal, RawFinding, isMoneyPage, pathOf } from './detector-types';

/**
 * P0 #4 — Money-page availability regression: a transactional / GSC-clicked
 * page now returns 4xx/5xx live, or silently dropped out of the sitemap,
 * WITHOUT a covering redirect. The live probe (which follows ≤5 hops) is the
 * authority on "covering 301": a probe that ends on a 2xx via redirects is
 * intentional retirement → silence, per the plan's false-positive guard.
 *
 * Scope honesty: only pages that actually received a live probe count as
 * evaluated — the probe set is bounded by the run's live-fetch budget, so
 * scopeComplete is false whenever the budget cut the suspect list short.
 */
export const MONEY_PAGE_VERSION = 1;

export function detectMoneyPageRegression(
  pages: PageSignal[],
  gscWindow: GscWindow | null,
): DetectorResult {
  const findings: RawFinding[] = [];
  const evaluatedSubjects: string[] = [];
  let errored = 0;
  let timedOut = 0;

  // Subjects: money pages INCLUDING tombstoned ones (a page that vanished from
  // the sitemap is exactly the suspect this detector exists for).
  const subjects = pages.filter((p) => isMoneyPage(p));

  for (const p of subjects) {
    if (!p.live) continue; // not probed (budget) → not evaluated
    if (!p.live.ok) {
      if (p.live.timedOut) timedOut += 1; else errored += 1;
      continue;
    }
    evaluatedSubjects.push(p.subjectKey);

    const finalStatus = p.live.finalStatus ?? p.live.status;
    const redirected = p.live.redirectChain.length > 0;
    const baseEvidence = {
      url: p.url,
      liveStatus: p.live.status,
      finalStatus,
      finalUrl: p.live.finalUrl,
      redirectChain: p.live.redirectChain,
      fetchedAt: p.live.fetchedAt,
      missingFromSitemapAt: p.missingFromSitemapAt,
      crawlDerivedStatus: p.crawl?.derivedStatus ?? null,
      gscClicks: p.gscClicks,
      gscImpressions: p.gscImpressions,
      gscWindow,
      isTransactional: p.isTransactional,
    };
    const rawSignal = {
      status: p.live.status,
      finalStatus,
      finalUrl: p.live.finalUrl,
      redirectChain: p.live.redirectChain,
      missingFromSitemapAt: p.missingFromSitemapAt,
    };

    if (finalStatus != null && finalStatus >= 400) {
      findings.push({
        checkType: 'money_page_regression',
        subjectKey: p.subjectKey,
        severity: 'critical',
        title: redirected
          ? `Money page ${pathOf(p.url)} redirects to a dead end (HTTP ${finalStatus})`
          : `Money page ${pathOf(p.url)} returns HTTP ${finalStatus}`,
        evidence: { ...baseEvidence, note: 'No covering redirect to a live page — direct traffic loss.' },
        affectedUrls: [{ url: p.url, pageId: p.pageId }],
        fixRoute: `/sites/{siteId}/redirects`,
        rawSignal,
      });
      continue;
    }

    // Redirect ending on a live 2xx = covered retirement → silence.
    if (redirected) continue;

    // Live 2xx but dropped from the sitemap — reachable, invisible to discovery.
    if (finalStatus != null && finalStatus < 300 && p.missingFromSitemapAt != null) {
      findings.push({
        checkType: 'money_page_regression',
        subjectKey: p.subjectKey,
        severity: 'warning',
        title: `Money page ${pathOf(p.url)} dropped out of the sitemap (still live)`,
        evidence: {
          ...baseEvidence,
          note: 'The page serves 200 but is no longer listed in the sitemap — likely unintentional.',
        },
        affectedUrls: [{ url: p.url, pageId: p.pageId }],
        fixRoute: `/sites/{siteId}/index-status`,
        rawSignal,
      });
    }
  }

  return {
    checkType: 'money_page_regression',
    version: MONEY_PAGE_VERSION,
    findings,
    coverage: {
      subjectsSelected: subjects.length,
      subjectsEvaluated: evaluatedSubjects.length,
      subjectsErrored: errored,
      subjectsTimedOut: timedOut,
      scopeComplete: evaluatedSubjects.length === subjects.length,
    },
    evaluatedSubjects,
  };
}
