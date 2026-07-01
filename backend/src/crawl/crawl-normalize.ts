import * as crypto from 'crypto';

/**
 * Pure, versioned normalization for GSC URL-Inspection results. NO I/O, NO Nest
 * — just deterministic functions so the whole thing is trivially unit-testable
 * and reproducible. This is the trust substrate of the Index Inspection module:
 * every derived value the UI shows is computed here from the raw Google payload,
 * and the raw payload is always stored alongside so a mapping bug can be
 * re-normalized retroactively WITHOUT re-spending inspection quota.
 *
 * Honesty rules baked in (from the plan's advisor review):
 *  - `coverageState` is a FREE-TEXT string, not an enum. We match against a
 *    curated table of known strings; anything unrecognised maps to `unknown`
 *    (fail-loud) and NEVER silently to "not indexed".
 *  - `isIndexed` is derived from coverage membership, never from `verdict==='PASS'`.
 *  - The state hash EXCLUDES `lastCrawlTime` (and referringUrls/sitemap) so a
 *    fresh crawl time alone is not recorded as a "change".
 *
 * Bump MAPPING_VERSION whenever the derivation logic below changes so stored
 * rows can be re-normalized and trends stay comparable.
 */

export const MAPPING_VERSION = 1;
export const API_VERSION = 'urlInspection.index.inspect/v1';

/** Normalized status buckets. `unknown` is the fail-loud fallback. */
export type DerivedStatus =
  | 'indexed'
  | 'crawled_not_indexed'
  | 'discovered_not_indexed'
  | 'excluded_noindex'
  | 'blocked_robots'
  | 'canonical_alternate'
  | 'redirect'
  | 'not_found'
  | 'soft_404'
  | 'server_error'
  | 'forbidden'
  | 'unknown_to_google'
  | 'unknown';

/** The shape we care about out of `inspectionResult.indexStatusResult`. */
export interface IndexStatusResult {
  verdict?: string;
  coverageState?: string;
  robotsTxtState?: string;
  indexingState?: string;
  lastCrawlTime?: string;
  pageFetchState?: string;
  googleCanonical?: string;
  userCanonical?: string;
  sitemap?: string[];
  referringUrls?: string[];
  crawledAs?: string;
}

export interface NormalizedInspection {
  derivedStatus: DerivedStatus;
  /** true / false / null(=indeterminate, e.g. unknown coverageState). */
  isIndexed: boolean | null;
  verdict: string | null;
  coverageStateRaw: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  crawledAs: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  canonicalConflict: boolean;
  googleLastCrawlTime: Date | null;
  stateHash: string;
  mappingVersion: number;
  apiVersion: string;
}

interface CoverageRule {
  status: DerivedStatus;
  isIndexed: boolean;
}

/**
 * Curated map of known `coverageState` strings → derived bucket. Keys are the
 * output of {@link normalizeCoverageKey} (lower-cased, quote/whitespace-folded)
 * so we tolerate Google's smart-quotes and spacing drift. Unknown strings fall
 * through to `unknown` — deliberately loud.
 */
const COVERAGE_RULES: Record<string, CoverageRule> = {
  // ── Indexed ──────────────────────────────────────────────────────────────
  'submitted and indexed': { status: 'indexed', isIndexed: true },
  'indexed, not submitted in sitemap': { status: 'indexed', isIndexed: true },
  'indexed, low interest': { status: 'indexed', isIndexed: true },
  'indexed, though blocked by robots.txt': { status: 'indexed', isIndexed: true },
  // ── Crawled / discovered but not indexed ─────────────────────────────────
  'crawled - currently not indexed': { status: 'crawled_not_indexed', isIndexed: false },
  'discovered - currently not indexed': { status: 'discovered_not_indexed', isIndexed: false },
  // ── Canonical / duplicate exclusions ─────────────────────────────────────
  'alternate page with proper canonical tag': { status: 'canonical_alternate', isIndexed: false },
  'duplicate without user-selected canonical': { status: 'canonical_alternate', isIndexed: false },
  'duplicate, google chose different canonical than user': { status: 'canonical_alternate', isIndexed: false },
  'duplicate, submitted url not selected as canonical': { status: 'canonical_alternate', isIndexed: false },
  // ── Directive / robots exclusions ────────────────────────────────────────
  "excluded by 'noindex' tag": { status: 'excluded_noindex', isIndexed: false },
  'excluded by noindex tag': { status: 'excluded_noindex', isIndexed: false },
  'blocked by robots.txt': { status: 'blocked_robots', isIndexed: false },
  'blocked due to unauthorized request (401)': { status: 'forbidden', isIndexed: false },
  'blocked due to access forbidden (403)': { status: 'forbidden', isIndexed: false },
  // ── Fetch outcomes ───────────────────────────────────────────────────────
  'page with redirect': { status: 'redirect', isIndexed: false },
  'not found (404)': { status: 'not_found', isIndexed: false },
  'soft 404': { status: 'soft_404', isIndexed: false },
  'server error (5xx)': { status: 'server_error', isIndexed: false },
  'blocked due to other 4xx issue': { status: 'server_error', isIndexed: false },
  // ── Never seen ───────────────────────────────────────────────────────────
  'url is unknown to google': { status: 'unknown_to_google', isIndexed: false },
};

export function normalizeCoverageKey(s: string | undefined | null): string {
  if (!s) return '';
  return s
    .replace(/[‘’“”]/g, "'") // smart quotes → '
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Canonicalise a URL for CONFLICT comparison only (the stored raw values are
 * kept verbatim for display). Folds scheme→https, drops leading `www.`,
 * lower-cases the host, strips the default port, decodes, and removes a trailing
 * slash — so http/https, www, casing and slash noise don't manufacture phantom
 * canonical conflicts. Returns the input untouched if it can't be parsed.
 */
export function normalizeUrlForCompare(u: string | undefined | null): string {
  if (!u) return '';
  try {
    const url = new URL(u.trim());
    let host = url.hostname.toLowerCase().replace(/^www\./, '');
    if (url.port && ((url.protocol === 'https:' && url.port === '443') || (url.protocol === 'http:' && url.port === '80'))) {
      // default port — ignore
    } else if (url.port) {
      host += `:${url.port}`;
    }
    let pathname = decodeURI(url.pathname);
    if (pathname.length > 1 && pathname.endsWith('/')) pathname = pathname.slice(0, -1);
    const search = url.search || '';
    return `https://${host}${pathname}${search}`;
  } catch {
    return u.trim().replace(/\/+$/, '').toLowerCase();
  }
}

export function canonicalMismatch(
  google: string | undefined | null,
  user: string | undefined | null,
): boolean {
  // A conflict requires BOTH sides present and genuinely different once
  // normalized. A missing side is "not enough information", not a conflict.
  if (!google || !user) return false;
  return normalizeUrlForCompare(google) !== normalizeUrlForCompare(user);
}

function parseCrawlTime(s: string | undefined | null): Date | null {
  if (!s) return null;
  const t = Date.parse(s);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Derive the normalized bucket + isIndexed from a raw indexStatusResult.
 * Primary signal is the curated coverageState table; if coverageState is
 * present but unrecognised we return `unknown` (fail-loud) rather than guessing.
 */
export function deriveStatus(r: IndexStatusResult): { status: DerivedStatus; isIndexed: boolean | null } {
  const key = normalizeCoverageKey(r.coverageState);
  const rule = COVERAGE_RULES[key];
  if (rule) return { status: rule.status, isIndexed: rule.isIndexed };

  // No coverageState at all — fall back to structured fetch/indexing enums so a
  // hard fetch failure is still classified rather than dumped into `unknown`.
  if (!key) {
    switch (r.pageFetchState) {
      case 'NOT_FOUND': return { status: 'not_found', isIndexed: false };
      case 'SOFT_404': return { status: 'soft_404', isIndexed: false };
      case 'SERVER_ERROR': return { status: 'server_error', isIndexed: false };
      case 'ACCESS_DENIED':
      case 'ACCESS_FORBIDDEN':
      case 'BLOCKED_4XX': return { status: 'forbidden', isIndexed: false };
      case 'BLOCKED_ROBOTS_TXT': return { status: 'blocked_robots', isIndexed: false };
      case 'REDIRECT_ERROR': return { status: 'redirect', isIndexed: false };
    }
    if (r.indexingState === 'BLOCKED_BY_ROBOTS_TXT') return { status: 'blocked_robots', isIndexed: false };
    if (r.indexingState === 'BLOCKED_BY_META_TAG' || r.indexingState === 'BLOCKED_BY_HTTP_HEADER') {
      return { status: 'excluded_noindex', isIndexed: false };
    }
  }

  // Coverage string present but unrecognised → loud unknown, isIndexed unknown.
  return { status: 'unknown', isIndexed: null };
}

/**
 * State hash for the append-only ledger. Includes everything that constitutes a
 * meaningful state change; EXCLUDES `lastCrawlTime`, `referringUrls`, `sitemap`
 * and our own timestamps so a fresh crawl time (or a re-inspection that changed
 * nothing) is not logged as a transition. Canonicals are normalized before
 * hashing so cosmetic slash/www noise doesn't churn the ledger.
 */
export function computeStateHash(n: {
  derivedStatus: DerivedStatus;
  verdict: string | null;
  coverageStateRaw: string | null;
  robotsTxtState: string | null;
  indexingState: string | null;
  pageFetchState: string | null;
  crawledAs: string | null;
  googleCanonical: string | null;
  userCanonical: string | null;
  canonicalConflict: boolean;
  mappingVersion: number;
}): string {
  const material = JSON.stringify({
    s: n.derivedStatus,
    v: n.verdict ?? '',
    c: normalizeCoverageKey(n.coverageStateRaw),
    r: n.robotsTxtState ?? '',
    i: n.indexingState ?? '',
    f: n.pageFetchState ?? '',
    a: n.crawledAs ?? '',
    gc: normalizeUrlForCompare(n.googleCanonical),
    uc: normalizeUrlForCompare(n.userCanonical),
    cx: n.canonicalConflict,
    m: n.mappingVersion,
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

/** Map a full URL-Inspection API response into our normalized shape. */
export function normalizeInspection(indexStatus: IndexStatusResult): NormalizedInspection {
  const r = indexStatus ?? {};
  const { status, isIndexed } = deriveStatus(r);
  const googleCanonical = r.googleCanonical?.trim() || null;
  const userCanonical = r.userCanonical?.trim() || null;
  const canonicalConflict = canonicalMismatch(googleCanonical, userCanonical);

  const base = {
    derivedStatus: status,
    isIndexed,
    verdict: r.verdict ?? null,
    coverageStateRaw: r.coverageState ?? null,
    robotsTxtState: r.robotsTxtState ?? null,
    indexingState: r.indexingState ?? null,
    pageFetchState: r.pageFetchState ?? null,
    crawledAs: r.crawledAs ?? null,
    googleCanonical,
    userCanonical,
    canonicalConflict,
    googleLastCrawlTime: parseCrawlTime(r.lastCrawlTime),
    mappingVersion: MAPPING_VERSION,
    apiVersion: API_VERSION,
  };

  return { ...base, stateHash: computeStateHash(base) };
}

/**
 * Coverage summary WITH its denominator — never a naked "% indexed". Given the
 * per-page current statuses, returns explicit counts so the UI can always show
 * "N of M inspected · K never checked".
 */
export interface CoverageSummary {
  total: number;
  inspected: number;
  neverChecked: number;
  indexed: number;
  notIndexed: number;
  unknown: number;
  byStatus: Record<string, number>;
}

export function coverageWithDenominator(
  rows: Array<{ isIndexed: boolean | null; derivedStatus: DerivedStatus | null }>,
): CoverageSummary {
  const summary: CoverageSummary = {
    total: rows.length,
    inspected: 0,
    neverChecked: 0,
    indexed: 0,
    notIndexed: 0,
    unknown: 0,
    byStatus: {},
  };
  for (const row of rows) {
    if (row.derivedStatus == null) {
      summary.neverChecked += 1;
      continue;
    }
    summary.inspected += 1;
    summary.byStatus[row.derivedStatus] = (summary.byStatus[row.derivedStatus] ?? 0) + 1;
    if (row.isIndexed === true) summary.indexed += 1;
    else if (row.isIndexed === false) summary.notIndexed += 1;
    else summary.unknown += 1;
  }
  return summary;
}
