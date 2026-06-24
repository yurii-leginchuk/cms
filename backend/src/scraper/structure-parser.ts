import {
  ContentStructure,
  ContentSection,
  SectionType,
  FaqPair,
} from '../pages/content-structure';

const HEADING_RE = /^(#{1,6})\s+(.*\S)\s*$/;
const FAQ_HEADING_RE = /\b(faqs?|frequently asked|questions?)\b/i;
const PREAMBLE_LABEL_RE = /^(Title|URL Source|Published Time|Markdown Content):/;

interface RawSection {
  level: number;
  heading: string | null;
  bodyLines: string[];
}

/** Strip the `Title:/URL Source:/Markdown Content:` preamble Jina prepends in
 *  plain markdown mode. JSON mode has no preamble, so this is a no-op there. */
function stripPreamble(markdown: string): string {
  const lines = markdown.split('\n');
  let start = 0;
  let sawLabel = false;
  for (let i = 0; i < lines.length && i < 8; i++) {
    const line = lines[i];
    if (PREAMBLE_LABEL_RE.test(line)) {
      sawLabel = true;
      start = i + 1;
      if (/^Markdown Content:/.test(line)) break;
    } else if (sawLabel && line.trim() === '') {
      start = i + 1;
    } else if (sawLabel) {
      break;
    }
  }
  return sawLabel ? lines.slice(start).join('\n') : markdown;
}

function stripMarkdown(md: string): string {
  return md
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1') // images → alt
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // links → text
    .replace(/^#{1,6}\s+/gm, '') // heading markers
    .replace(/^\s*>\s?/gm, '') // blockquotes
    .replace(/^\s*([-*+]|\d+\.)\s+/gm, '') // list markers
    .replace(/^\s*\|?[\s:|-]+\|?\s*$/gm, '') // table separator rows
    .replace(/\|/g, ' ') // table pipes
    .replace(/[*_`~]/g, '') // emphasis / code
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugify(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);
}

function wordCount(text: string): number {
  const t = text.trim();
  return t ? t.split(/\s+/).length : 0;
}

function detectType(markdown: string): SectionType {
  const lines = markdown.split('\n').map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return 'heading';

  const tableLines = lines.filter((l) => /^\|.*\|$/.test(l)).length;
  if (tableLines >= 2) return 'table';

  const listLines = lines.filter((l) => /^([-*+]|\d+\.)\s+/.test(l)).length;
  if (listLines >= 2 && listLines >= lines.length * 0.6) return 'list';

  return 'prose';
}

/** Split a FAQ section's body into Q/A pairs when questions are plain lines
 *  (e.g. "**How long?**\nanswer") rather than their own headings. */
function extractInlineFaqPairs(text: string): FaqPair[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const pairs: FaqPair[] = [];
  let question: string | null = null;
  let answer: string[] = [];
  const flush = () => {
    if (question && answer.length) {
      pairs.push({ question, answer: answer.join(' ').trim() });
    }
    answer = [];
  };
  for (const line of lines) {
    if (/\?$/.test(line) && line.length <= 200) {
      flush();
      question = line.replace(/\?$/, '?');
    } else if (question) {
      answer.push(line);
    }
  }
  flush();
  return pairs;
}

function buildSection(raw: RawSection, index: number, anchor: string): ContentSection {
  const markdown = raw.bodyLines.join('\n').trim();
  const headingMd = raw.heading ? `${'#'.repeat(Math.max(1, raw.level))} ${raw.heading}\n` : '';
  const fullMarkdown = (headingMd + markdown).trim();
  const text = stripMarkdown(markdown);
  return {
    index,
    level: raw.level,
    heading: raw.heading,
    anchor,
    type: detectType(markdown),
    markdown: fullMarkdown,
    text,
    wordCount: wordCount(text),
  };
}

function splitInternalExternal(
  links: Record<string, string> | undefined,
  siteUrl?: string,
): ContentStructure['links'] {
  const internal: ContentStructure['links']['internal'] = [];
  const external: ContentStructure['links']['external'] = [];
  if (!links) return { internal, external };

  let host: string | null = null;
  try {
    host = siteUrl ? new URL(siteUrl).host : null;
  } catch {
    host = null;
  }

  for (const [text, url] of Object.entries(links)) {
    if (!url) continue;
    const entry = { text: text || url, url };
    const isInternal =
      url.startsWith('/') ||
      url.startsWith('#') ||
      (() => {
        try {
          return host ? new URL(url).host === host : false;
        } catch {
          return false;
        }
      })();
    (isInternal ? internal : external).push(entry);
  }
  return { internal, external };
}

function buildImages(images: Record<string, string> | undefined): ContentStructure['images'] {
  if (!images) return { total: 0, withAlt: 0, missingAlt: [] };
  const entries = Object.entries(images);
  const missingAlt: string[] = [];
  let withAlt = 0;
  for (const [alt, url] of entries) {
    const hasAlt = !!alt && !/^image[\s-]?\d*$/i.test(alt.trim());
    if (hasAlt) withAlt++;
    else if (url) missingAlt.push(url);
  }
  return { total: entries.length, withAlt, missingAlt };
}

export interface ParseStructureInput {
  markdown: string;
  source: ContentStructure['source'];
  siteUrl?: string;
  links?: Record<string, string>;
  images?: Record<string, string>;
}

/**
 * Parse a markdown document into a ContentStructure. Pure & deterministic —
 * no LLM tokens. Splits on ATX headings, types each section, folds FAQ
 * sub-sections into faqPairs, and computes the outline/links/images/stats.
 */
export function parseStructure(input: ParseStructureInput): ContentStructure {
  const md = stripPreamble(input.markdown ?? '');
  const lines = md.split('\n');

  // 1. Split into raw sections on ATX headings.
  const raws: RawSection[] = [];
  let current: RawSection | null = null;
  for (const line of lines) {
    const m = HEADING_RE.exec(line);
    if (m) {
      if (current) raws.push(current);
      current = { level: m[1].length, heading: m[2].trim(), bodyLines: [] };
    } else {
      if (!current) current = { level: 0, heading: null, bodyLines: [] };
      current.bodyLines.push(line);
    }
  }
  if (current) raws.push(current);

  // 2. Fold FAQ regions: a faq-ish heading absorbs deeper sub-sections as Q/A.
  const folded: RawSection[] = [];
  const faqPairsByRaw = new Map<RawSection, FaqPair[]>();
  for (let i = 0; i < raws.length; i++) {
    const raw = raws[i];
    if (raw.heading && raw.level > 0 && FAQ_HEADING_RE.test(raw.heading)) {
      const pairs: FaqPair[] = [];
      let j = i + 1;
      while (j < raws.length && raws[j].level > raw.level) {
        const child = raws[j];
        if (child.heading) {
          pairs.push({
            question: child.heading,
            answer: stripMarkdown(child.bodyLines.join('\n')).trim(),
          });
          // keep the child's text inside the FAQ section markdown too
          raw.bodyLines.push(`### ${child.heading}`, ...child.bodyLines);
        }
        j++;
      }
      const inline = pairs.length ? pairs : extractInlineFaqPairs(stripMarkdown(raw.bodyLines.join('\n')));
      if (inline.length) faqPairsByRaw.set(raw, inline);
      folded.push(raw);
      i = j - 1; // skip absorbed children
    } else {
      folded.push(raw);
    }
  }

  // 3. Build sections with unique anchors.
  const usedAnchors = new Set<string>();
  const sections: ContentSection[] = [];
  folded.forEach((raw, idx) => {
    // drop fully-empty lead-in fragments
    if (!raw.heading && raw.bodyLines.join('').trim() === '') return;
    let anchor = slugify(raw.heading ?? `section-${idx + 1}`) || `section-${idx + 1}`;
    let n = 2;
    while (usedAnchors.has(anchor)) anchor = `${slugify(raw.heading ?? 'section')}-${n++}`;
    usedAnchors.add(anchor);

    const section = buildSection(raw, sections.length, anchor);
    const pairs = faqPairsByRaw.get(raw);
    if (pairs && pairs.length) {
      section.type = 'faq';
      section.faqPairs = pairs;
    }
    sections.push(section);
  });

  // 4. Aggregates.
  const outline = sections
    .filter((s) => s.heading)
    .map((s) => ({ level: s.level, heading: s.heading as string, anchor: s.anchor }));

  const links = splitInternalExternal(input.links, input.siteUrl);
  const images = buildImages(input.images);

  return {
    version: 1,
    source: input.source,
    sections,
    outline,
    links,
    images,
    stats: {
      wordCount: sections.reduce((sum, s) => sum + s.wordCount, 0),
      sectionCount: sections.length,
      faqCount: sections.reduce((sum, s) => sum + (s.faqPairs?.length ?? 0), 0),
      tableCount: sections.filter((s) => s.type === 'table').length,
    },
    parsedAt: new Date().toISOString(),
  };
}

/** Wrap an already-flat text blob as a single-section structure (last resort). */
export function singleProseStructure(
  text: string,
  source: ContentStructure['source'],
): ContentStructure {
  const clean = text.trim();
  const sections: ContentSection[] = clean
    ? [{
        index: 0,
        level: 0,
        heading: null,
        anchor: 'content',
        type: 'prose',
        markdown: clean,
        text: clean,
        wordCount: wordCount(clean),
      }]
    : [];
  return {
    version: 1,
    source,
    sections,
    outline: [],
    links: { internal: [], external: [] },
    images: { total: 0, withAlt: 0, missingAlt: [] },
    stats: {
      wordCount: sections[0]?.wordCount ?? 0,
      sectionCount: sections.length,
      faqCount: 0,
      tableCount: 0,
    },
    parsedAt: new Date().toISOString(),
  };
}
