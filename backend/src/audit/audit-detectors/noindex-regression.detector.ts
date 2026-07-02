import { DetectorResult, GscWindow, PageSignal, RawFinding, pathOf } from './detector-types';

/**
 * P0 #1 — Indexability regression: a page whose CMS intent is indexable now
 * shows `noindex` (robots meta in the stored parse, or the X-Robots-Tag /
 * live meta of a budgeted re-verification fetch).
 *
 * Delta discipline: `pages.indexDirective === 'noindex'` is INTENT — an
 * intentionally-noindexed page is configuration, never an alert. The finding
 * fires only on intent-vs-observed divergence; run-to-run new/persisting is
 * the diff's job (stable fingerprint per page URL).
 *
 * False-positive guard: when a live re-verification was performed and shows
 * NO noindex, the stored parse is treated as stale and nothing fires.
 */
export const NOINDEX_REGRESSION_VERSION = 1;

export function detectNoindexRegression(
  pages: PageSignal[],
  gscWindow: GscWindow | null,
): DetectorResult {
  const findings: RawFinding[] = [];
  const evaluatedSubjects: string[] = [];
  let errored = 0;

  // Subjects: pages still in the sitemap (a tombstoned page's indexability is moot).
  const subjects = pages.filter((p) => p.missingFromSitemapAt == null);

  for (const p of subjects) {
    if (!p.head) {
      errored += 1; // no rawHtml — cannot evaluate observed state
      continue;
    }
    evaluatedSubjects.push(p.subjectKey);

    const intentNoindex = p.intentDirective === 'noindex';
    if (intentNoindex) continue;

    const storedNoindex = p.head.robotsNoindex;
    const liveXRobotsNoindex =
      p.live?.xRobotsTag != null && /\bnoindex\b|\bnone\b/i.test(p.live.xRobotsTag);
    const liveMetaNoindex = p.live?.head?.robotsNoindex === true;

    // A completed live re-check is authoritative over the stored parse.
    const liveChecked = p.live != null && p.live.ok && p.live.head != null;
    const observedNoindex = liveChecked
      ? liveMetaNoindex || liveXRobotsNoindex
      : storedNoindex || liveXRobotsNoindex;

    if (!observedNoindex) continue;

    findings.push({
      checkType: 'noindex_regression',
      subjectKey: p.subjectKey,
      severity: 'critical',
      title: `noindex appeared on ${pathOf(p.url)}`,
      evidence: {
        url: p.url,
        robotsMeta: p.head.robotsMeta,
        xRobotsTag: p.live?.xRobotsTag ?? null,
        intentDirective: p.intentDirective,
        verifiedLive: liveChecked,
        liveFetchedAt: p.live?.fetchedAt ?? null,
        lastScrapedAt: p.lastScrapedAt,
        crawlDerivedStatus: p.crawl?.derivedStatus ?? null,
        gscClicks: p.gscClicks,
        gscImpressions: p.gscImpressions,
        gscWindow,
        isTransactional: p.isTransactional,
      },
      affectedUrls: [{ url: p.url, pageId: p.pageId }],
      fixRoute: `/sites/{siteId}/meta/${p.pageId}`,
      rawSignal: {
        robotsMeta: p.head.robotsMeta,
        xRobotsTag: p.live?.xRobotsTag ?? null,
        liveRobotsMeta: p.live?.head?.robotsMeta ?? null,
        intentDirective: p.intentDirective,
        lastScrapedAt: p.lastScrapedAt,
      },
    });
  }

  return {
    checkType: 'noindex_regression',
    version: NOINDEX_REGRESSION_VERSION,
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
