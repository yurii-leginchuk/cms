/**
 * Pure HTML normalization for cloaking detection. No DB / network / NestJS —
 * deterministic and unit-tested, mirroring schema-validator.ts.
 *
 * Strips chrome/boilerplate and volatile bits (scripts, nonces, ad/cookie
 * widgets) so that a content hash is stable across harmless re-renders, and
 * extracts the signals detectors compare across axes: main text, external
 * <script src> origins, and external <a href> domains.
 */

import * as cheerio from 'cheerio';
import { createHash } from 'crypto';

export const NORMALIZATION_VERSION = 1;

/** Selectors removed before extracting main content (noise / chrome / volatile). */
const NOISE_SELECTORS = [
  'style', 'noscript', 'iframe', 'svg', 'head',
  'nav', 'footer', 'header', 'aside',
  '#wpadminbar', '.site-header', '.site-footer', '.main-navigation',
  'form', '.breadcrumb', '.wp-pagenavi', '.navigation', '.post-navigation',
  '[class*="cookie"]', '[class*="popup"]', '[class*="modal"]', '[class*="banner"]',
  '[class*="sidebar"]', '[class*="widget"]', '[class*="share"]', '[class*="social"]',
];

/** Preferred main-content roots, most-specific first. */
const MAIN_CONTENT_SELECTORS = [
  'main article', 'article',
  '.entry-content', '.post-content', '.page-content', '.site-content',
  '.wp-block-post-content',
  '[class*="elementor-section"]',
  'main', '#content', '#main', '.content', '#primary',
];

export interface NormalizedPage {
  /** Cleaned, deduped main-content text. */
  mainText: string;
  /** sha256 of mainText — stable dedup / diff key. */
  contentHash: string;
  /** Distinct external hosts referenced by <script src>. */
  externalScriptOrigins: string[];
  /** Distinct external registrable domains referenced by <a href>. */
  externalLinkDomains: string[];
}

/** Registrable-domain approximation (last two labels). Good enough for diffing. */
export function registrableDomain(hostname: string): string {
  const labels = hostname.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  return labels.slice(-2).join('.');
}

function hostOf(href: string, baseUrl: string): string | null {
  try {
    return new URL(href, baseUrl).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isExternal(host: string | null, pageHost: string): boolean {
  if (!host) return false;
  if (host === pageHost) return false;
  return registrableDomain(host) !== registrableDomain(pageHost);
}

function cleanText(raw: string): string {
  const lines = raw
    .split(/\n+/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l.length >= 4);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const line of lines) {
    const key = line.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
  }
  return out.join('\n');
}

export function normalize(html: string, pageUrl: string): NormalizedPage {
  const $ = cheerio.load(html);
  const pageHost = (() => {
    try {
      return new URL(pageUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  })();

  // Collect external resource origins BEFORE stripping scripts.
  const scriptOrigins = new Set<string>();
  $('script[src]').each((_i, el) => {
    const host = hostOf($(el).attr('src') ?? '', pageUrl);
    if (isExternal(host, pageHost)) scriptOrigins.add(host!);
  });

  const linkDomains = new Set<string>();
  $('a[href]').each((_i, el) => {
    const host = hostOf($(el).attr('href') ?? '', pageUrl);
    if (isExternal(host, pageHost)) linkDomains.add(registrableDomain(host!));
  });

  // Strip noise, then extract main content text.
  $('script').remove();
  for (const sel of NOISE_SELECTORS) $(sel).remove();

  let $root: ReturnType<typeof $> | null = null;
  for (const sel of MAIN_CONTENT_SELECTORS) {
    const found = $(sel).first();
    if (found.length > 0) {
      $root = found;
      break;
    }
  }
  const mainText = cleanText(($root ?? $('body')).text());
  const contentHash = createHash('sha256').update(mainText).digest('hex');

  return {
    mainText,
    contentHash,
    externalScriptOrigins: [...scriptOrigins].sort(),
    externalLinkDomains: [...linkDomains].sort(),
  };
}
