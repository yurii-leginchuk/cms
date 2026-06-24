/**
 * Extract structured image PLACEMENTS from a page's raw HTML — the foundational
 * fix the advisory board demanded. Replaces the old alt-keyed Jina
 * `Record<alt,url>` (which collided empty-alt images and counted URL pairs, not
 * files) with one record per <img> occurrence, carrying:
 *   - canonical identity (so the same file across pages/variants dedupes)
 *   - the VERBATIM observed alt (null when the attribute is absent ≠ "")
 *   - surrounding text + nearest heading + figure caption → AI grounding context
 *
 * PURE (cheerio over a string) and tested. Scoped to content imagery: skips
 * data-URIs and 1px tracking/spacer pixels. Theme/nav/footer chrome that the
 * scraper's X-Remove-Selector already drops is out of scope by design.
 */

import * as cheerio from 'cheerio';
import { canonicalImageKey } from './image-identity';
import { classifyAlt, AltQuality } from './alt-quality';

// The installed @types/cheerio (legacy) clashes with cheerio 1.x runtime nodes,
// so we avoid annotating cheerio nodes with library types and use loose locals.
/* eslint-disable @typescript-eslint/no-explicit-any */

export interface ImagePlacementRecord {
  /** Identity of the underlying file (deduped across variants & pages). */
  canonicalKey: string;
  /** Best-guess original full-size URL (https, suffixes stripped). */
  canonicalUrl: string;
  /** The exact src as authored on the page (for the WP inline-rewrite path). */
  rawSrc: string;
  /** Verbatim alt attribute, or null when absent (distinct from ""). */
  observedAlt: string | null;
  quality: AltQuality;
  /** Nearest preceding heading text, for grounding. */
  nearestHeading: string | null;
  /** <figcaption> text when the img is inside a <figure>. */
  caption: string | null;
  /** Trimmed surrounding text (parent block + siblings), capped. */
  surroundingText: string;
  /** Rough DOM order index on the page (stable-ish disambiguator). */
  domIndex: number;
}

const MAX_SURROUNDING = 600;

/** First candidate URL from a `srcset` (`"a.jpg 1x, b.jpg 2x"` → `a.jpg`). */
function firstSrcsetUrl(srcset: string | undefined): string {
  if (!srcset) return '';
  const first = srcset.split(',')[0]?.trim() ?? '';
  return first.split(/\s+/)[0] ?? '';
}

/** A 1x1 / spacer / tracking pixel we should never surface for alt work. */
function isTrackingPixel($img: any, src: string): boolean {
  if (/^data:/i.test(src)) return true;
  const w = parseInt(String($img.attr('width') ?? ''), 10);
  const h = parseInt(String($img.attr('height') ?? ''), 10);
  if ((w && w <= 2) || (h && h <= 2)) return true;
  if (/(?:spacer|pixel|1x1|blank)\.(?:gif|png)/i.test(src)) return true;
  return false;
}

function tagOf(node: any): string {
  return node && typeof node.tagName === 'string' ? node.tagName : '';
}

function nearestHeadingFor($: any, el: any): string | null {
  // Walk previous siblings / ancestors looking for the closest heading.
  let node = $(el);
  while (node && node.length) {
    let prev = node.prev();
    while (prev.length) {
      if (/^h[1-6]$/i.test(tagOf(prev.get(0)))) {
        const t = prev.text().trim();
        if (t) return t;
      }
      const inner = prev.find('h1,h2,h3,h4,h5,h6').last();
      if (inner.length) {
        const t = inner.text().trim();
        if (t) return t;
      }
      prev = prev.prev();
    }
    node = node.parent();
    if (!node.length || tagOf(node.get(0)) === 'body') break;
  }
  return null;
}

/**
 * Parse all content <img> placements out of raw HTML, resolved against the
 * page URL. Order follows document order. Tracking pixels and data-URIs are
 * skipped. Duplicate placements (same canonicalKey appearing twice on the page)
 * are KEPT as separate records — the caller dedupes to the library level.
 */
export function extractImagePlacements(
  rawHtml: string,
  pageUrl: string,
): ImagePlacementRecord[] {
  if (!rawHtml || !rawHtml.trim()) return [];
  const $ = cheerio.load(rawHtml) as any;

  // Restrict to main content where possible, mirroring the scraper's selectors;
  // fall back to <body> so nothing is missed on atypical templates.
  const scopeSel = $('article, main, .entry-content, .elementor-section').first();
  // cheerio.load always yields a <body>; search within scope, else whole doc.
  const $imgs = scopeSel.length ? scopeSel.find('img') : $('img');

  const out: ImagePlacementRecord[] = [];
  let domIndex = 0;

  $imgs.each((_: number, el: any) => {
    const $img = $(el);
    // Resolve the REAL image URL. Many themes lazy-load: `src` is an inline SVG
    // placeholder while the real URL lives in data-src / data-lazy-src / srcset.
    // Prefer a non-data src, then lazy attributes, then the first srcset URL.
    const srcAttr = ($img.attr('src') ?? '').trim();
    const lazy =
      ($img.attr('data-src') ||
        $img.attr('data-lazy-src') ||
        firstSrcsetUrl($img.attr('data-srcset')) ||
        firstSrcsetUrl($img.attr('srcset')) ||
        '').trim();
    // Use src unless it's a data-URI placeholder; then fall back to the lazy URL.
    const src = !srcAttr || /^data:/i.test(srcAttr) ? lazy : srcAttr;
    if (!src) return;
    if (isTrackingPixel($img, src)) return;

    const ident = canonicalImageKey(src, pageUrl);
    if (!ident) return;

    // alt attribute: undefined → absent (null); present → verbatim string.
    const altRaw = $img.attr('alt');
    const observedAlt = altRaw === undefined ? null : altRaw;

    const $figure = $img.closest('figure');
    const caption =
      $figure.length && $figure.find('figcaption').length
        ? $figure.find('figcaption').first().text().trim() || null
        : null;

    // Surrounding text: the closest meaningful block ancestor's text.
    const $block = $img.closest('figure, p, div, li, section, article');
    let surrounding = ($block.length ? $block : $img.parent()).text();
    surrounding = surrounding.replace(/\s+/g, ' ').trim();
    if (surrounding.length > MAX_SURROUNDING) {
      surrounding = surrounding.slice(0, MAX_SURROUNDING).trim();
    }

    out.push({
      canonicalKey: ident.canonicalKey,
      canonicalUrl: ident.canonicalUrl,
      rawSrc: src,
      observedAlt,
      quality: classifyAlt(observedAlt, ident.canonicalUrl),
      nearestHeading: nearestHeadingFor($, el),
      caption,
      surroundingText: surrounding,
      domIndex: domIndex++,
    });
  });

  return out;
}
