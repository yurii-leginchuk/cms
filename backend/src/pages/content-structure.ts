/**
 * Structured representation of a scraped page's content.
 *
 * Produced by the scraper (Jina markdown → parsed, or the readability/cheerio
 * fallback) and stored on `pages.contentStructure` (jsonb). It is the canonical
 * source of truth; the flat `pages.cleanContent` is DERIVED from `sections` via
 * `deriveCleanContent()` so every existing reader keeps working unchanged.
 *
 * Both consumers are served from this one array:
 *  - AI / agent: section-addressable, citeable evidence (anchor + heading + type)
 *  - SEO specialist: a readable outline / FAQ / table / link / alt-coverage view
 */

export type SectionType = 'prose' | 'faq' | 'table' | 'list' | 'heading';

export interface FaqPair {
  question: string;
  answer: string;
}

export interface ContentSection {
  /** Stable order in the document. */
  index: number;
  /** Owning heading level 1..6; 0 = pre-heading lead-in. */
  level: number;
  /** Heading text ("Pricing"); null for the lead-in section. */
  heading: string | null;
  /** Slug — the citeable address, e.g. "pricing-by-pool-type". */
  anchor: string;
  type: SectionType;
  /** Section body with markdown preserved (tables / lists intact). */
  markdown: string;
  /** Plaintext projection (for embedding + word count). */
  text: string;
  wordCount: number;
  /** Present when type === 'faq'. */
  faqPairs?: FaqPair[];
}

export interface ContentLink {
  text: string;
  url: string;
}

export interface ContentStructure {
  version: 1;
  source: 'jina-json' | 'jina-markdown' | 'readability-fallback';
  sections: ContentSection[];
  /** Headings tree for the panel outline. */
  outline: { level: number; heading: string; anchor: string }[];
  links: { internal: ContentLink[]; external: ContentLink[] };
  images: { total: number; withAlt: number; missingAlt: string[] };
  stats: {
    wordCount: number;
    sectionCount: number;
    faqCount: number;
    tableCount: number;
  };
  parsedAt: string;
}

/**
 * Flatten a ContentStructure back into the legacy `cleanContent` text surface.
 * Headings are preserved (unlike the old `cleanText` which deduped them away),
 * so flat consumers (meta generation, faithfulness, keyword search) get a
 * better text than before while knowing nothing about sections.
 */
export function deriveCleanContent(structure: ContentStructure): string {
  return structure.sections
    .map((s) => (s.heading ? `## ${s.heading}\n${s.text}` : s.text))
    .map((s) => s.trim())
    .filter(Boolean)
    .join('\n\n');
}
