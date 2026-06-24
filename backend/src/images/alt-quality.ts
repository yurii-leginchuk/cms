/**
 * Alt-text quality classification — PURE, tested. Encodes the SEO/accessibility
 * rules the advisory board required so "% with alt" is honest and the work
 * queue is actionable. The distinction between absent / empty / filename-junk /
 * placeholder / meaningful is a deliberate product decision, not a hidden regex.
 *
 *  - absent       : the <img> had no alt attribute at all → needs alt
 *  - empty        : alt="" → INTENTIONALLY decorative; a VALID outcome, not a defect
 *  - junkFilename : alt is basically the file name (DSC_0042, hero-final-v2.jpg)
 *  - placeholder  : generic ("image", "image 1", "img", "photo") → needs alt
 *  - meaningful   : real human/AI description → leave alone unless user edits
 */

import { imageFileName } from './image-identity';

export type AltQuality =
  | 'absent'
  | 'empty'
  | 'junkFilename'
  | 'placeholder'
  | 'meaningful';

const PLACEHOLDER_RE =
  /^(?:image|img|photo|picture|graphic|icon|logo|banner)[\s_-]?\d*$/i;
const FILENAME_RE = /\.(?:jpe?g|png|gif|webp|svg|avif|bmp|tiff?)$/i;

/**
 * Classify an observed alt value. `altAttr` is the verbatim attribute value, or
 * `null` when the attribute was absent (distinct from `""`).
 */
export function classifyAlt(
  altAttr: string | null,
  canonicalUrl: string,
): AltQuality {
  if (altAttr === null) return 'absent';
  const v = altAttr.trim();
  if (v === '') return 'empty';
  if (PLACEHOLDER_RE.test(v)) return 'placeholder';

  // Filename junk: alt looks like a media file name, OR equals the actual file
  // name (with separators normalized to spaces).
  if (FILENAME_RE.test(v)) return 'junkFilename';
  const file = imageFileName(canonicalUrl)
    .replace(/\.[a-z0-9]+$/i, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .toLowerCase();
  if (file && v.replace(/[-_]+/g, ' ').trim().toLowerCase() === file) {
    return 'junkFilename';
  }

  return 'meaningful';
}

/**
 * Does this image need alt work? Only `meaningful` is "done". An observed
 * `empty` (alt="") is NOT auto-treated as decorative — absence of alt is a work
 * item requiring a decision (write alt, or deliberately mark decorative). The
 * deliberate-decorative case is tracked by the SiteImage.decorative flag and is
 * excluded by callers, so it never re-enters the work queue.
 */
export function needsAlt(q: AltQuality): boolean {
  return q !== 'meaningful';
}

/** A placement "has alt" for the honest per-placement coverage metric. Only a
 *  meaningful alt counts; an observed empty alt is treated as not-yet-covered
 *  (a deliberate decorative decision is handled at the image level, not here). */
export function placementHasAlt(q: AltQuality): boolean {
  return q === 'meaningful';
}
