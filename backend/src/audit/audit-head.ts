import * as cheerio from 'cheerio';

/**
 * Pure HTML-head signal extraction — deterministic, NO I/O. The `pages` table
 * stores CMS INTENT in `indexDirective`/`canonical` (what the meta editor
 * pushes to Yoast); the OBSERVED state a crawler would see lives only in the
 * stored `rawHtml` (refreshed by the nightly parse) — this module extracts it.
 * The intent-vs-observed divergence is exactly what the P0 regression
 * detectors alert on.
 */

export interface HeadSignal {
  /** <title> text, trimmed; null when absent. */
  title: string | null;
  /** Verbatim content of <meta name="robots"> (first match); null = absent. */
  robotsMeta: string | null;
  /** true ⇔ robots meta (or googlebot meta) contains a `noindex` token. */
  robotsNoindex: boolean;
  /** Verbatim href of <link rel="canonical"> (first match); null = absent. */
  canonical: string | null;
  /** http:// asset references (script/link/img/source src|href), capped. */
  httpAssets: string[];
  /** Count of <link rel="alternate" hreflang> entries (Phase 2 gate input). */
  hreflangCount: number;
}

const HTTP_ASSET_CAP = 20;

function hasNoindexToken(content: string | undefined | null): boolean {
  if (!content) return false;
  return content
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .some((t) => t === 'noindex' || t === 'none');
}

/**
 * Extract the head signal from a stored (or live-fetched) HTML document.
 * Returns null for empty/absent HTML so callers can distinguish "no data"
 * from "data says fine" — a page without rawHtml is NOT evaluated.
 */
export function parseHeadSignal(html: string | null | undefined): HeadSignal | null {
  if (!html || html.trim() === '') return null;
  const $ = cheerio.load(html);

  const title = $('head title').first().text().trim() || $('title').first().text().trim() || null;

  let robotsMeta: string | null = null;
  let robotsNoindex = false;
  $('meta[name]').each((_, el) => {
    const name = String($(el).attr('name') ?? '').toLowerCase();
    if (name !== 'robots' && name !== 'googlebot') return;
    const content = $(el).attr('content') ?? '';
    if (name === 'robots' && robotsMeta == null) robotsMeta = content;
    if (hasNoindexToken(content)) robotsNoindex = true;
  });

  const canonical = $('link[rel="canonical"]').first().attr('href')?.trim() || null;

  const httpAssets: string[] = [];
  $('script[src], link[href][rel="stylesheet"], img[src], source[src], iframe[src]').each((_, el) => {
    if (httpAssets.length >= HTTP_ASSET_CAP) return;
    const v = ($(el).attr('src') ?? $(el).attr('href') ?? '').trim();
    if (/^http:\/\//i.test(v)) httpAssets.push(v);
  });

  const hreflangCount = $('link[rel="alternate"][hreflang]').length;

  return { title, robotsMeta, robotsNoindex, canonical, httpAssets, hreflangCount };
}

/** Common 404/error-template title patterns (soft-404 heuristic input). */
const NOT_FOUND_TITLE = /\b(page not found|not found|error 404|404 error|page (doesn'?t|does not) exist|nothing (was )?found|oops[!.,]|niet gevonden|introuvable)\b|(^|\s)404(\s|$)/i;

export function titleLooks404(title: string | null | undefined): boolean {
  if (!title) return false;
  return NOT_FOUND_TITLE.test(title.trim());
}
