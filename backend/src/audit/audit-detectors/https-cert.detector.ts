import { DetectorResult, HttpsSignal, PageSignal, RawFinding } from './detector-types';
import { SITE_SUBJECT } from '../audit-fingerprint';

/**
 * P0 #6 — HTTPS / certificate regression (site-scoped, three independent axes,
 * each its own stable finding via discriminator):
 *  - `cert`                — expired / untrusted chain (critical), or expiring
 *                            within 14 days (warning: fix before it's an outage).
 *  - `http_not_redirecting`— plain http:// serves 2xx instead of redirecting
 *                            to HTTPS (critical: full duplicate site).
 *  - `mixed_content`       — http:// assets on MANY pages (sitewide = critical;
 *                            a single asset on one page is P1, out of scope).
 *
 * An unreachable port-80 is NOT a finding (many hosts drop http entirely).
 */
export const HTTPS_CERT_VERSION = 1;

const CERT_WARNING_DAYS = 14;
/** "Sitewide" mixed content = at least this many pages AND ≥30% of parsed pages. */
const MIXED_MIN_PAGES = 10;
const MIXED_MIN_RATIO = 0.3;

export function detectHttpsRegression(input: {
  https: HttpsSignal;
  pages: PageSignal[];
  siteUrl: string;
}): DetectorResult {
  const { https, pages, siteUrl } = input;
  const findings: RawFinding[] = [];
  let axesEvaluated = 0;
  let errored = 0;

  // ── cert axis ──────────────────────────────────────────────────────────────
  if (https.cert.error != null && https.cert.authorized == null) {
    errored += 1; // could not inspect at all → axis not evaluated
  } else {
    axesEvaluated += 1;
    const days = https.cert.daysRemaining;
    const expired = days != null && days < 0;
    const untrusted = https.cert.authorized === false && !expired;
    const expiring = !expired && days != null && days <= CERT_WARNING_DAYS;

    if (expired || untrusted || expiring) {
      findings.push({
        checkType: 'https_regression',
        subjectKey: SITE_SUBJECT,
        discriminator: 'cert',
        severity: expired || untrusted ? 'critical' : 'warning',
        title: expired
          ? 'TLS certificate has EXPIRED'
          : untrusted
            ? 'TLS certificate is not trusted (chain fails validation)'
            : `TLS certificate expires in ${days} day${days === 1 ? '' : 's'}`,
        evidence: {
          siteUrl,
          validTo: https.cert.validTo,
          daysRemaining: days,
          issuer: https.cert.issuer,
          authorized: https.cert.authorized,
          httpsStatus: https.https.status,
          fetchedAt: https.fetchedAt,
        },
        affectedUrls: [{ url: siteUrl }],
        fixRoute: null,
        rawSignal: { cert: https.cert, httpsStatus: https.https.status },
      });
    }
  }

  // ── http→https redirect axis ───────────────────────────────────────────────
  if (https.http.error != null && https.http.status == null) {
    // port 80 unreachable — acceptable configuration, axis simply not applicable
    axesEvaluated += 1;
  } else {
    axesEvaluated += 1;
    const s = https.http.status;
    if (s != null && s >= 200 && s < 300) {
      findings.push({
        checkType: 'https_regression',
        subjectKey: SITE_SUBJECT,
        discriminator: 'http_not_redirecting',
        severity: 'critical',
        title: 'http:// serves content instead of redirecting to HTTPS',
        evidence: {
          siteUrl,
          httpStatus: s,
          location: https.http.location,
          redirectsToHttps: https.http.redirectsToHttps,
          fetchedAt: https.fetchedAt,
          note: 'The whole site is duplicated over plain HTTP — signals split and users get the insecure version.',
        },
        affectedUrls: [{ url: siteUrl.replace(/^https:/i, 'http:') }],
        fixRoute: null,
        rawSignal: { http: https.http },
      });
    }
  }

  // ── sitewide mixed content axis (from stored parses — full inventory) ─────
  const parsed = pages.filter((p) => p.head != null && p.missingFromSitemapAt == null);
  if (parsed.length > 0) {
    axesEvaluated += 1;
    const withMixed = parsed.filter((p) => (p.head!.httpAssets.length ?? 0) > 0);
    if (withMixed.length >= MIXED_MIN_PAGES && withMixed.length / parsed.length >= MIXED_MIN_RATIO) {
      findings.push({
        checkType: 'https_regression',
        subjectKey: SITE_SUBJECT,
        discriminator: 'mixed_content',
        severity: 'critical',
        title: `Sitewide mixed content — http:// assets on ${withMixed.length} of ${parsed.length} pages`,
        evidence: {
          pagesWithMixedContent: withMixed.length,
          pagesParsed: parsed.length,
          sampleAssets: withMixed.slice(0, 5).flatMap((p) => p.head!.httpAssets.slice(0, 2)),
          samplePages: withMixed.slice(0, 20).map((p) => p.url),
          note: 'Likely a template/CDN-level http:// reference — one fix, sitewide effect.',
        },
        affectedUrls: withMixed.slice(0, 100).map((p) => ({ url: p.url, pageId: p.pageId })),
        fixRoute: null,
        rawSignal: {
          pagesWithMixedContent: withMixed.length,
          pagesParsed: parsed.length,
        },
      });
    }
  }

  // All three axes share subjectKey='site' (per-axis identity lives in the
  // fingerprint discriminator), so 'site' counts as EVALUATED only when every
  // axis completed — a failed cert probe must not let a mixed-content finding
  // auto-resolve. Conservative on purpose.
  const selected = 3;
  const scopeComplete = axesEvaluated === selected;
  return {
    checkType: 'https_regression',
    version: HTTPS_CERT_VERSION,
    findings,
    coverage: {
      subjectsSelected: selected,
      subjectsEvaluated: axesEvaluated,
      subjectsErrored: errored,
      subjectsTimedOut: 0,
      scopeComplete,
    },
    evaluatedSubjects: scopeComplete ? [SITE_SUBJECT] : [],
  };
}
