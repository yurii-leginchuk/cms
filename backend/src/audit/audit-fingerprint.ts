import * as crypto from 'crypto';
import { AuditCheckType } from './audit-finding.entity';

/**
 * Pure, versioned finding-identity rules — NO I/O. Frozen at v1 BEFORE the
 * schema migration (locked decision D4, 2026-07-02). Identity is the SUBJECT
 * (checkType + subjectKey [+ discriminator]) — never the observed value — so
 * trivial evidence changes can't cause resolve→recreate flapping, which would
 * destroy the diff, mute persistence, and (Phase 3) task dedupe.
 *
 * Per-detector identity rules (v1):
 *  - noindex_regression      subject = normalized page URL
 *  - canonical_hijack        subject = normalized page URL
 *  - money_page_regression   subject = normalized page URL
 *  - soft_404_suspect        subject = normalized page URL
 *  - sitemap_broken          subject = 'site'
 *  - https_regression        subject = 'site', discriminator = axis
 *                            ('cert' | 'http_not_redirecting' | 'mixed_content')
 *  - robots_txt_regression   subject = 'site',
 *                            discriminator = 'unreachable' | normalized rule
 *                            (one finding per offending Disallow rule)
 *
 * Bump FINGERPRINT_VERSION if any rule below changes — existing fingerprints
 * become incomparable and a re-baseline run is required.
 */

export const FINGERPRINT_VERSION = 1;

/** Site-scoped subject key. */
export const SITE_SUBJECT = 'site';

/**
 * Normalize a URL for SUBJECT IDENTITY (not for matcher semantics — redirects
 * keep their own stricter normalizer). Folds scheme→https, lower-cases host,
 * strips `www.`, the default port, any fragment, and a trailing slash (except
 * root) — a page's identity shouldn't churn on those. KEEPS path case and the
 * query string (both can identify distinct pages). Unparseable input is
 * returned trimmed, so identity is still stable.
 */
export function normalizeAuditUrl(u: string | null | undefined): string {
  if (!u) return '';
  const raw = u.trim();
  if (raw === '') return '';
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    let host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (
      url.port &&
      !((url.protocol === 'https:' && url.port === '443') ||
        (url.protocol === 'http:' && url.port === '80'))
    ) {
      host += `:${url.port}`;
    }
    let path = url.pathname;
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    return `https://${host}${path}${url.search}`;
  } catch {
    return raw;
  }
}

/** Host of a URL, lower-cased, `www.` stripped; null when unparseable. */
export function auditHost(u: string | null | undefined): string | null {
  if (!u) return null;
  try {
    return new URL(u.trim()).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

/**
 * The stable finding fingerprint: sha256(checkType:subjectKey[:discriminator]).
 * `subjectKey` must already be normalized by the caller (detectors use
 * {@link normalizeAuditUrl} for page subjects and {@link SITE_SUBJECT} for
 * site-scoped ones).
 */
export function findingFingerprint(
  checkType: AuditCheckType,
  subjectKey: string,
  discriminator?: string | null,
): string {
  const material = discriminator
    ? `${checkType}:${subjectKey}:${discriminator}`
    : `${checkType}:${subjectKey}`;
  return crypto.createHash('sha256').update(material).digest('hex');
}

/**
 * Well-known SNAPSHOT fingerprint per site-scoped detector — the channel that
 * carries the "previous copy" (robots.txt body, sitemap state, …) between runs
 * in `audit_observations`, independent of whether any finding exists.
 */
export function snapshotFingerprint(checkType: AuditCheckType): string {
  return findingFingerprint(checkType, SITE_SUBJECT, 'snapshot');
}

/**
 * Scope signature — hash of the selection rule + subject-set sizes, stored on
 * every run so trend readers can mark discontinuities when the scope changed
 * (the sampling-bias guard from the data-analyst advisory).
 */
export function scopeSignature(input: {
  selectionRule: string;
  pagesTotal: number;
  moneyPages: number;
  fingerprintVersion: number;
}): string {
  const material = JSON.stringify({
    r: input.selectionRule,
    p: input.pagesTotal,
    m: input.moneyPages,
    v: input.fingerprintVersion,
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}
