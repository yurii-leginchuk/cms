import { DetectorResult, GscWindow, PageSignal, RawFinding, isMoneyPage, pathOf } from './detector-types';
import { auditHost, normalizeAuditUrl } from '../audit-fingerprint';

/**
 * P0 #7 — Canonical hijack: a page's OBSERVED canonical (parsed from the
 * stored rawHtml) newly points off-site, or at the homepage while the page is
 * not the homepage (the classic "bad deploy canonicals everything to /" that
 * deindexes a site slowly).
 *
 * False-positive guards:
 *  - Both sides are normalized (scheme/www/trailing-slash folded) before
 *    comparison — a `https://www.` vs `https://` difference is NOT a hijack.
 *  - When the CMS ITSELF set this exact canonical (meta-editor intent matches
 *    the observed value), it is configuration — legit cross-domain syndication
 *    set on purpose stays silent; an unexplained one alerts and can be
 *    accepted/muted (persists by fingerprint).
 */
export const CANONICAL_HIJACK_VERSION = 1;

export function detectCanonicalHijack(
  pages: PageSignal[],
  siteUrl: string,
  gscWindow: GscWindow | null,
): DetectorResult {
  const findings: RawFinding[] = [];
  const evaluatedSubjects: string[] = [];
  let errored = 0;

  const siteHost = auditHost(siteUrl);
  const homeNormalized = normalizeAuditUrl(siteUrl);

  const subjects = pages.filter((p) => p.missingFromSitemapAt == null);

  for (const p of subjects) {
    if (!p.head) {
      errored += 1;
      continue;
    }
    evaluatedSubjects.push(p.subjectKey);

    const observed = p.head.canonical;
    if (!observed) continue; // no canonical tag — not this detector's business

    const observedNorm = normalizeAuditUrl(observed);
    const selfNorm = p.subjectKey;
    if (observedNorm === selfNorm) continue; // self-canonical — fine

    // CMS intent match ⇒ deliberately configured in the meta editor.
    if (p.cmsCanonical && normalizeAuditUrl(p.cmsCanonical) === observedNorm) continue;

    const observedHost = auditHost(observedNorm.startsWith('http') ? observedNorm : null);
    const offsite = siteHost != null && observedHost != null && observedHost !== siteHost;
    const homepageHijack = !offsite && observedNorm === homeNormalized && selfNorm !== homeNormalized;

    if (!offsite && !homepageHijack) continue; // on-site non-self canonical = dedupe config, not a hijack

    findings.push({
      checkType: 'canonical_hijack',
      subjectKey: p.subjectKey,
      severity: isMoneyPage(p) ? 'critical' : 'warning',
      title: offsite
        ? `Canonical on ${pathOf(p.url)} points off-site (${observedHost})`
        : `Canonical on ${pathOf(p.url)} points at the homepage`,
      evidence: {
        url: p.url,
        observedCanonical: observed,
        cmsCanonicalIntent: p.cmsCanonical,
        googleCanonical: p.crawl?.googleCanonical ?? null,
        kind: offsite ? 'offsite' : 'homepage',
        gscClicks: p.gscClicks,
        gscImpressions: p.gscImpressions,
        gscWindow,
        isTransactional: p.isTransactional,
        lastScrapedAt: p.lastScrapedAt,
        note: 'All ranking signals consolidate to the canonical target. If this cross-domain canonical is intentional syndication, Accept the finding.',
      },
      affectedUrls: [{ url: p.url, pageId: p.pageId }],
      fixRoute: `/sites/{siteId}/meta/${p.pageId}`,
      rawSignal: {
        observedCanonical: observed,
        cmsCanonicalIntent: p.cmsCanonical,
        googleCanonical: p.crawl?.googleCanonical ?? null,
        lastScrapedAt: p.lastScrapedAt,
      },
    });
  }

  return {
    checkType: 'canonical_hijack',
    version: CANONICAL_HIJACK_VERSION,
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
