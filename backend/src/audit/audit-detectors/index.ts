import { AuditCheckType } from '../audit-finding.entity';
import { NOINDEX_REGRESSION_VERSION } from './noindex-regression.detector';
import { ROBOTS_TXT_VERSION } from './robots-txt.detector';
import { SITEMAP_BROKEN_VERSION } from './sitemap-broken.detector';
import { MONEY_PAGE_VERSION } from './money-page.detector';
import { SOFT_404_VERSION } from './soft-404.detector';
import { HTTPS_CERT_VERSION } from './https-cert.detector';
import { CANONICAL_HIJACK_VERSION } from './canonical-hijack.detector';

export { detectNoindexRegression } from './noindex-regression.detector';
export {
  detectRobotsTxtRegression,
  parseRobotsDisallows,
  robotsRuleMatches,
} from './robots-txt.detector';
export { detectSitemapBroken } from './sitemap-broken.detector';
export { detectMoneyPageRegression } from './money-page.detector';
export { detectSoft404Suspect } from './soft-404.detector';
export { detectHttpsRegression } from './https-cert.detector';
export { detectCanonicalHijack } from './canonical-hijack.detector';
export * from './detector-types';

/** `{checkType: version}` snapshot recorded on every run. */
export const AUDIT_DETECTOR_VERSIONS: Record<AuditCheckType, number> = {
  noindex_regression: NOINDEX_REGRESSION_VERSION,
  robots_txt_regression: ROBOTS_TXT_VERSION,
  sitemap_broken: SITEMAP_BROKEN_VERSION,
  money_page_regression: MONEY_PAGE_VERSION,
  soft_404_suspect: SOFT_404_VERSION,
  https_regression: HTTPS_CERT_VERSION,
  canonical_hijack: CANONICAL_HIJACK_VERSION,
};

/** Human catalog — drives the first-run teaching card and per-detector labels. */
export const AUDIT_DETECTOR_CATALOG: Record<AuditCheckType, { label: string; description: string }> = {
  noindex_regression: {
    label: 'Indexability regression',
    description: 'A previously-indexable page now carries noindex (meta or X-Robots-Tag) without CMS intent.',
  },
  robots_txt_regression: {
    label: 'robots.txt regression',
    description: 'robots.txt broke (5xx/unreachable) or a NEW Disallow rule covers pages the CMS manages. Diff-based.',
  },
  sitemap_broken: {
    label: 'Sitemap broken',
    description: 'The sitemap is 404/5xx, unparseable, empty, or lists a wrong host.',
  },
  money_page_regression: {
    label: 'Money-page availability',
    description: 'A transactional / GSC-clicked page returns 4xx/5xx or dropped from the sitemap — without a covering redirect.',
  },
  soft_404_suspect: {
    label: 'Soft-404 suspicion',
    description: 'A trafficked page serves 200 but looks like an error template (heuristic; cross-checked with Google’s verdict).',
  },
  https_regression: {
    label: 'HTTPS / certificate',
    description: 'Certificate expired/expiring, http:// not redirecting to HTTPS, or sitewide mixed content.',
  },
  canonical_hijack: {
    label: 'Canonical hijack',
    description: 'A canonical newly points off-site or at the homepage (the slow-deindex deploy bug).',
  },
};
