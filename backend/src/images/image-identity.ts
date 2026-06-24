/**
 * Canonical image identity — the SINGLE source of truth for "are these two
 * <img> the same file?". Every variant of one physical image (CDN host swap,
 * WordPress resize suffix, retina `@2x`, `-scaled`, query strings, protocol-
 * relative `//`, http/https) must fold to one stable `canonicalKey` so the
 * site image library counts files, not URL strings.
 *
 * PURE & deterministic — no I/O. Tested by image-identity.spec.ts with a
 * variant→canonical table. Nothing else in the codebase may re-derive image
 * identity ad-hoc; always call canonicalImageKey().
 *
 * NOTE (Phase 1): identity is derived from the scraped URL only. When/if the
 * scraper reconciles against the WP Media API, a resolved `wpAttachmentId`
 * becomes the authoritative key and this URL key becomes the fallback — the
 * SiteImage entity already carries a nullable wpAttachmentId for that upgrade.
 */

/** WordPress resize suffix, e.g. `hero-300x200.jpg` → strip `-300x200`. */
const WP_SIZE_SUFFIX = /-\d{1,5}x\d{1,5}(?=\.[a-z0-9]+$)/i;
/** Retina / scaled / rotated variants WP and themes generate. */
const VARIANT_SUFFIX = /-(?:scaled|rotated|e\d{6,})(?=\.[a-z0-9]+$)/i;
const RETINA_SUFFIX = /@\d+x(?=\.[a-z0-9]+$)/i;

/** Query params worth keeping (rare); everything else (cache-busters, CDN
 *  resize params, `?ver=`) is dropped so it can't fragment identity. */
const KEEP_QUERY_PARAMS = new Set<string>([]); // none for now — drop them all

export interface NormalizedImage {
  /** Stable identity key (deduped across variants & pages). */
  canonicalKey: string;
  /** Absolute, https-forced URL with variant suffixes stripped — the best
   *  guess at the ORIGINAL full-size file (useful as a thumbnail src). */
  canonicalUrl: string;
  /** File extension (lowercased, no dot), '' if none. */
  ext: string;
}

/**
 * Resolve a possibly-relative / protocol-relative src against the page URL,
 * returning an absolute URL or null when it cannot be parsed (e.g. a `data:`
 * URI, which is never a library image).
 */
export function resolveImageUrl(src: string, pageUrl: string): string | null {
  const raw = (src ?? '').trim();
  if (!raw) return null;
  if (/^data:/i.test(raw)) return null; // inline data URIs are not assets
  try {
    // Handles absolute, relative, and protocol-relative (`//cdn/...`).
    return new URL(raw, pageUrl).href;
  } catch {
    return null;
  }
}

/**
 * Normalize an absolute image URL into a canonical identity. Lowercases host,
 * forces https, strips the WP resize/variant suffixes, drops fragments and
 * (by default) all query params, and collapses a trailing slash. The path case
 * is preserved (servers are case-sensitive on path) but the query is dropped.
 */
export function normalizeImageUrl(absoluteUrl: string): NormalizedImage | null {
  let u: URL;
  try {
    u = new URL(absoluteUrl);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

  // Force https for identity (http vs https of the same file are one image).
  u.protocol = 'https:';
  u.host = u.host.toLowerCase();
  u.hash = '';

  // Drop disallowed query params (default: all).
  const kept = new URLSearchParams();
  for (const [k, v] of u.searchParams) {
    if (KEEP_QUERY_PARAMS.has(k.toLowerCase())) kept.append(k, v);
  }
  u.search = kept.toString();

  // Strip WP/theme size & variant suffixes from the filename.
  let path = u.pathname;
  // Apply repeatedly-safe single passes (order: retina → size → variant).
  path = path.replace(RETINA_SUFFIX, '');
  path = path.replace(WP_SIZE_SUFFIX, '');
  path = path.replace(VARIANT_SUFFIX, '');
  u.pathname = path;

  const extMatch = path.match(/\.([a-z0-9]+)$/i);
  const ext = extMatch ? extMatch[1].toLowerCase() : '';

  const canonicalUrl = u.href;
  // canonicalKey = host + path (+ kept query), no protocol — protocol already
  // normalized; this is the dedupe key shown/stored as the image's identity.
  const canonicalKey = (u.host + u.pathname + (u.search ? u.search : '')).replace(/\/$/, '');

  return { canonicalKey, canonicalUrl, ext };
}

/**
 * Convenience: resolve a raw src against its page, then canonicalize. Returns
 * null for un-addressable srcs (data URIs, blanks, unparseable).
 */
export function canonicalImageKey(
  src: string,
  pageUrl: string,
): NormalizedImage | null {
  const abs = resolveImageUrl(src, pageUrl);
  if (!abs) return null;
  return normalizeImageUrl(abs);
}

/** A bare filename, used to detect junk alt that's just the file name. */
export function imageFileName(canonicalUrl: string): string {
  try {
    const p = new URL(canonicalUrl).pathname;
    return decodeURIComponent(p.split('/').pop() ?? '') || canonicalUrl;
  } catch {
    return canonicalUrl;
  }
}
