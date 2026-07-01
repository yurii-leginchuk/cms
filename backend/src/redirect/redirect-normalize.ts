import * as crypto from 'crypto';

/**
 * Pure, versioned normalization for Redirection-plugin redirects. NO I/O, NO Nest
 * — just deterministic functions so the whole thing is trivially unit-testable and
 * reproducible. This is the trust substrate of the Redirect module: the raw plugin
 * rows are always stored verbatim alongside, and every derived value (identity
 * fingerprint, the "did anything change" whole-set hash) is computed here so a
 * mapping bug can be re-derived retroactively without re-polling WordPress.
 *
 * Honesty rules baked in (from the design's advisor review):
 *  - Redirect matching semantics are STRICTER than canonical comparison: a
 *    trailing slash or a query string can be significant to the plugin's matcher.
 *    So {@link normalizeRedirectUrl} deliberately does NOT fold trailing slashes
 *    or query strings — over-normalizing would manufacture phantom loops or hide
 *    real ones. We only lower-case the host and drop the default port / fragment.
 *  - The raw `source`/`target` strings are kept verbatim for display; the
 *    normalized forms are used ONLY for the fingerprint (and, later, the graph).
 *
 * Bump MAPPING_VERSION whenever the normalization below changes, and
 * DETECTION_VERSION whenever the derived-issue logic changes (Phase 1 has none
 * yet — the column exists so later phases stay comparable), so stored rows can be
 * re-derived and trends stay comparable.
 */

export const MAPPING_VERSION = 1;
export const DETECTION_VERSION = 1;
export const API_VERSION = 'poirier-cms.redirects/v1';

/** Raw redirect row as the WP plugin returns it (verbatim table columns). */
export interface RawRedirect {
  id: number | null;
  url: string;
  match_type: string | null;
  action_type: string | null;
  action_code: number | null;
  /** Target for `url` redirects; may be null for error/pass/etc. */
  action_data: unknown;
  match_data: unknown;
  regex: number; // 0 | 1
  group_id: number | null;
  position: number;
  status: string; // 'enabled' | 'disabled'
  last_access: string | null;
  last_count: number;
  title: string | null;
}

/** Raw group row as the WP plugin returns it. */
export interface RawGroup {
  id: number | null;
  name: string;
  module_id: number | null;
  status: string | null;
  position: number;
}

/** Our normalized projection of a single redirect. */
export interface NormalizedRedirect {
  pluginId: number | null;
  source: string;
  sourceNormalized: string;
  target: string | null;
  targetNormalized: string | null;
  matchType: string | null;
  actionType: string | null;
  actionCode: number | null;
  regex: boolean;
  groupId: number | null;
  position: number;
  enabled: boolean;
  title: string | null;
  /** WP clock — last time the redirect fired (null when never/unparseable). */
  wpLastAccess: Date | null;
  wpLastCount: number;
  /** Content-identity hash (stable across polls unless the redirect changes). */
  fingerprint: string;
  mappingVersion: number;
  detectionVersion: number;
}

/**
 * Canonicalise a redirect source/target for FINGERPRINT + graph comparison only
 * (the stored raw values are kept verbatim for display). Conservative on purpose:
 * lower-cases the host, folds scheme→https, strips the default port and any
 * fragment — but KEEPS the path (including a trailing slash) and the query string
 * exactly, because those are significant to Redirection's matcher. A relative
 * source (e.g. `/old-page`, the common case) is returned trimmed but otherwise
 * untouched. Returns the trimmed input if it can't be parsed as an absolute URL.
 */
export function normalizeRedirectUrl(u: string | undefined | null): string {
  if (!u) return '';
  const raw = u.trim();
  if (raw === '') return '';
  // Relative sources are the norm in Redirection — keep them verbatim (paths are
  // case-sensitive and a trailing slash matters).
  if (!/^https?:\/\//i.test(raw)) return raw;
  try {
    const url = new URL(raw);
    let host = url.hostname.toLowerCase();
    if (
      url.port &&
      !((url.protocol === 'https:' && url.port === '443') ||
        (url.protocol === 'http:' && url.port === '80'))
    ) {
      host += `:${url.port}`;
    }
    return `https://${host}${url.pathname}${url.search}`;
  } catch {
    return raw;
  }
}

/**
 * Extract the redirect target. For an `url` action the target lives in
 * `action_data` — either a bare string, or a `{ url: '…' }` object depending on
 * the plugin/storage version. Non-`url` actions (error/pass/random/nothing) have
 * no URL target, so we return null.
 */
export function extractTarget(r: RawRedirect): string | null {
  if (r.action_type && r.action_type !== 'url') return null;
  const d = r.action_data;
  if (typeof d === 'string') return d.trim() || null;
  if (d && typeof d === 'object') {
    const url = (d as Record<string, unknown>).url;
    if (typeof url === 'string') return url.trim() || null;
  }
  return null;
}

/**
 * Parse a WP datetime string (`Y-m-d H:i:s`, UTC in the DB) into a Date. The
 * plugin's "never accessed" sentinel (`0000-00-00 00:00:00`) and empty/`0` values
 * map to null — a redirect that never fired has no last-access, and we must never
 * present a zero date as a real timestamp.
 */
export function parseWpDate(s: string | null | undefined): Date | null {
  if (!s) return null;
  const trimmed = String(s).trim();
  if (trimmed === '' || trimmed === '0' || trimmed.startsWith('0000-00-00')) return null;
  // WP stores UTC without a zone suffix — parse it as UTC, not local.
  const iso = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}Z`
    : trimmed;
  const t = Date.parse(iso);
  return Number.isNaN(t) ? null : new Date(t);
}

/**
 * Content-identity fingerprint. Includes everything that makes a redirect "the
 * same rule": normalized source + match type + regex flag + group + action
 * type/code + normalized target. Deliberately EXCLUDES position, hit counters and
 * last-access so a re-order or a fresh hit is not seen as a content change.
 * `matchType`/`regex` are in the material because Redirection allows several rules
 * on one source distinguished only by those.
 */
export function computeFingerprint(n: {
  sourceNormalized: string;
  matchType: string | null;
  regex: boolean;
  groupId: number | null;
  actionType: string | null;
  actionCode: number | null;
  targetNormalized: string | null;
  mappingVersion: number;
}): string {
  const material = JSON.stringify({
    s: n.sourceNormalized,
    mt: n.matchType ?? '',
    rx: n.regex,
    g: n.groupId ?? 0,
    at: n.actionType ?? '',
    ac: n.actionCode ?? 0,
    t: n.targetNormalized ?? '',
    m: n.mappingVersion,
  });
  return crypto.createHash('sha256').update(material).digest('hex');
}

/** Map one raw plugin row into our normalized projection (+ fingerprint). */
export function normalizeRedirect(r: RawRedirect): NormalizedRedirect {
  const source = (r.url ?? '').trim();
  const sourceNormalized = normalizeRedirectUrl(source);
  const target = extractTarget(r);
  const targetNormalized = target ? normalizeRedirectUrl(target) : null;
  const regex = Number(r.regex) === 1;
  const matchType = r.match_type ?? null;
  const actionType = r.action_type ?? null;
  const actionCode = r.action_code != null ? Number(r.action_code) : null;
  const groupId = r.group_id != null ? Number(r.group_id) : null;

  const fingerprint = computeFingerprint({
    sourceNormalized,
    matchType,
    regex,
    groupId,
    actionType,
    actionCode,
    targetNormalized,
    mappingVersion: MAPPING_VERSION,
  });

  return {
    pluginId: r.id != null ? Number(r.id) : null,
    source,
    sourceNormalized,
    target,
    targetNormalized,
    matchType,
    actionType,
    actionCode,
    regex,
    groupId,
    position: Number(r.position ?? 0),
    enabled: (r.status ?? 'enabled') !== 'disabled',
    title: r.title?.trim() || null,
    wpLastAccess: parseWpDate(r.last_access),
    wpLastCount: Number(r.last_count ?? 0),
    fingerprint,
    mappingVersion: MAPPING_VERSION,
    detectionVersion: DETECTION_VERSION,
  };
}

/**
 * Whole-set hash — a cheap "did ANYTHING change since the last poll?" gate. The
 * per-item fingerprints are sorted (so plugin re-ordering alone doesn't churn it)
 * and hashed together. Equal to the previous run's hash ⇒ we can short-circuit
 * the per-item diff entirely.
 */
export function computeWholeSetHash(fingerprints: string[]): string {
  const sorted = [...fingerprints].sort();
  return crypto.createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}
