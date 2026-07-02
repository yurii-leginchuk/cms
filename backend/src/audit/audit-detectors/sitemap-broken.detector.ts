import { DetectorResult, RawFinding, SitemapSignal } from './detector-types';
import { SITE_SUBJECT, auditHost } from '../audit-fingerprint';

/**
 * P0 #3 — Sitemap broken: 404/5xx, XML parse error, empty urlset, or a
 * majority of listed URLs on the wrong host. The CMS's own page inventory AND
 * Google's discovery depend on this file; the scraper already tombstone-guards
 * an empty fetch, but nothing ALERTS — this does.
 *
 * Honesty guard: a transient transport error (timeout/DNS) is NOT a confirmed
 * broken sitemap — the detector is marked not-evaluated (scopeComplete=false),
 * the run goes `partial`, and any open finding stays `unconfirmed`.
 */
export const SITEMAP_BROKEN_VERSION = 1;

export function detectSitemapBroken(input: {
  sitemap: SitemapSignal;
  siteUrl: string;
}): DetectorResult {
  const { sitemap, siteUrl } = input;
  const findings: RawFinding[] = [];

  if (sitemap.transportError) {
    return result(findings, {
      subjectsSelected: 1,
      subjectsEvaluated: 0,
      subjectsErrored: 1,
      subjectsTimedOut: 0,
      scopeComplete: false,
    }, []);
  }

  const push = (severity: 'critical' | 'warning', title: string, extra: Record<string, unknown>) =>
    findings.push({
      checkType: 'sitemap_broken',
      subjectKey: SITE_SUBJECT,
      severity,
      title,
      evidence: {
        sitemapUrl: sitemap.url,
        status: sitemap.status,
        urlCount: sitemap.urlCount,
        parseError: sitemap.parseError,
        hosts: sitemap.hosts,
        fetchedAt: sitemap.fetchedAt,
        ...extra,
      },
      affectedUrls: [{ url: sitemap.url }],
      fixRoute: `/sites/{siteId}/index-status`, // "Resubmit sitemap" lives there
      rawSignal: {
        status: sitemap.status,
        urlCount: sitemap.urlCount,
        parseError: sitemap.parseError,
        hosts: sitemap.hosts,
      },
    });

  if (sitemap.status != null && sitemap.status >= 400) {
    push('critical', `Sitemap returns HTTP ${sitemap.status}`, {
      note: 'Google cannot discover pages through a dead sitemap; the CMS inventory also depends on it.',
    });
  } else if (sitemap.parseError) {
    push('critical', 'Sitemap is not parseable XML', { note: sitemap.parseError });
  } else if ((sitemap.urlCount ?? 0) === 0) {
    push('critical', 'Sitemap is empty (0 URLs)', {
      note: 'An empty sitemap usually means the generator broke. The nightly parse tombstone-guard is protecting the inventory.',
    });
  } else {
    const siteHost = auditHost(siteUrl);
    const wrongHosts = sitemap.hosts.filter((h) => siteHost != null && h !== siteHost);
    if (siteHost != null && wrongHosts.length > 0 && wrongHosts.length >= sitemap.hosts.length) {
      push('warning', `Sitemap lists URLs on the wrong host (${wrongHosts.join(', ')})`, {
        expectedHost: siteHost,
      });
    }
  }

  return result(findings, {
    subjectsSelected: 1,
    subjectsEvaluated: 1,
    subjectsErrored: 0,
    subjectsTimedOut: 0,
    scopeComplete: true,
  }, [SITE_SUBJECT]);
}

function result(
  findings: RawFinding[],
  coverage: DetectorResult['coverage'],
  evaluatedSubjects: string[],
): DetectorResult {
  return {
    checkType: 'sitemap_broken',
    version: SITEMAP_BROKEN_VERSION,
    findings,
    coverage,
    evaluatedSubjects,
  };
}
