/**
 * Deterministic HTML pruner for the schema AI pass.
 *
 * Markdown loses signals that matter for structured data (microdata/RDFa
 * attributes, tel:/mailto: links, <time datetime>, <address>, og: meta). This
 * strips scripts/styles and presentational attributes (class, style, data-attrs,
 * aria-attrs) but KEEPS the semantic skeleton + id + schema-relevant attributes
 * — a high-signal view to ground schema proposals. No length cap: the full
 * pruned structure is returned so no markup is silently dropped.
 *
 * Pure + unit-tested. JSON-LD <script> is intentionally removed (detected
 * schemas are passed to the model separately); microdata lives in attributes,
 * not scripts, so attribute pruning keeps itemprop/itemtype.
 */

import * as cheerio from 'cheerio';

const KEEP_ATTRS = new Set([
  'id', // kept: anchor targets (href="#faq") + element identity
  'href',
  'src',
  'alt',
  'title',
  'datetime',
  'itemprop',
  'itemtype',
  'itemscope',
  'content',
  'property',
  'name',
  'rel',
  'lang',
]);

const KEEP_META_NAMES = new Set(['description', 'author', 'keywords', 'robots']);

export function prunePageHtml(rawHtml: string): string {
  if (!rawHtml) return '';
  const $ = cheerio.load(rawHtml);

  // Drop script/style noise + non-content elements (keep canonical link).
  $(
    'script, style, noscript, svg, iframe, template, source, link:not([rel="canonical"])',
  ).remove();

  // Keep only schema-relevant <meta> (og:*/article:*/product:*, description,
  // author, keywords, robots, or itemprop).
  $('meta').each((_i, el) => {
    const prop = $(el).attr('property') ?? '';
    const name = ($(el).attr('name') ?? '').toLowerCase();
    const keep =
      /^(og:|article:|product:)/.test(prop) ||
      KEEP_META_NAMES.has(name) ||
      !!$(el).attr('itemprop');
    if (!keep) $(el).remove();
  });

  // Strip every attribute except the allow-list (removes class/id/style/data-*).
  $('*').each((_i, el) => {
    const attribs = (el as { attribs?: Record<string, string> }).attribs;
    if (!attribs) return;
    for (const attr of Object.keys(attribs)) {
      if (!KEEP_ATTRS.has(attr)) $(el).removeAttr(attr);
    }
  });

  // Collapse empty wrapper elements (a few passes shrink Elementor div soup).
  for (let pass = 0; pass < 3; pass++) {
    $('div, span, section, article, header, footer, main, ul, ol, li, p').each(
      (_i, el) => {
        const $el = $(el);
        if ($el.find('img, a, time, [itemprop], [datetime]').length) return;
        if ($el.text().replace(/\s+/g, '').length === 0) $el.remove();
      },
    );
  }

  const head = $('head').html() ?? '';
  const body = $('body').html() ?? $.root().html() ?? '';
  return `${head}\n${body}`
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/>\s+</g, '><')
    .replace(/\s+/g, ' ')
    .trim();
}
