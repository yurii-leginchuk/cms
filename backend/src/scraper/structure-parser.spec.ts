import { parseStructure, singleProseStructure } from './structure-parser';

describe('parseStructure', () => {
  const markdown = [
    '# Optimize Your Google Business Profile',
    '',
    'On Nov 3, 2025, Google deprecated the My Business Q&A API.',
    '',
    '## Quick Checklist for Gemini to Trust You',
    '',
    '- Complete every section of your Google Business Profile',
    '- Publish an on-site FAQ page',
    '- Add FAQPage, LocalBusiness, and Service JSON-LD schema',
    '',
    '## Pricing by Type',
    '',
    '| Plan | Cost |',
    '| --- | --- |',
    '| Basic | $10 |',
    '| Pro | $20 |',
    '',
    '## Frequently Asked Questions',
    '',
    '### How long does setup take?',
    'About two weeks.',
    '### Do you offer support?',
    'Yes, 24/7.',
  ].join('\n');

  const result = parseStructure({
    markdown,
    source: 'jina-json',
    siteUrl: 'https://poirier.agency',
    links: {
      'Internal guide': 'https://poirier.agency/ai-content',
      'External ref': 'https://google.com/business',
    },
    images: { 'Hero alt': 'https://poirier.agency/hero.jpg', '': 'https://poirier.agency/x.jpg' },
  });

  it('splits sections by heading and preserves order', () => {
    expect(result.sections.map((s) => s.heading)).toEqual([
      'Optimize Your Google Business Profile',
      'Quick Checklist for Gemini to Trust You',
      'Pricing by Type',
      'Frequently Asked Questions',
    ]);
  });

  it('detects list and table section types', () => {
    expect(result.sections[1].type).toBe('list');
    expect(result.sections[2].type).toBe('table');
  });

  it('folds FAQ sub-headings into faqPairs and types it as faq', () => {
    const faq = result.sections.find((s) => s.anchor === 'frequently-asked-questions');
    expect(faq?.type).toBe('faq');
    expect(faq?.faqPairs).toEqual([
      { question: 'How long does setup take?', answer: 'About two weeks.' },
      { question: 'Do you offer support?', answer: 'Yes, 24/7.' },
    ]);
  });

  it('builds an outline and unique anchors', () => {
    expect(result.outline).toHaveLength(4);
    expect(new Set(result.sections.map((s) => s.anchor)).size).toBe(result.sections.length);
  });

  it('splits internal vs external links', () => {
    expect(result.links.internal.map((l) => l.url)).toContain('https://poirier.agency/ai-content');
    expect(result.links.external.map((l) => l.url)).toContain('https://google.com/business');
  });

  it('computes image alt coverage', () => {
    expect(result.images.total).toBe(2);
    expect(result.images.withAlt).toBe(1);
    expect(result.images.missingAlt).toEqual(['https://poirier.agency/x.jpg']);
  });

  it('strips the Jina preamble', () => {
    const withPreamble = parseStructure({
      markdown: 'Title: X\nURL Source: https://x\nMarkdown Content:\n# Real Heading\nbody',
      source: 'jina-markdown',
    });
    expect(withPreamble.sections[0].heading).toBe('Real Heading');
  });
});

describe('singleProseStructure', () => {
  it('wraps flat text as one prose section', () => {
    const s = singleProseStructure('just some text', 'readability-fallback');
    expect(s.sections).toHaveLength(1);
    expect(s.sections[0].type).toBe('prose');
    expect(s.sections[0].text).toBe('just some text');
  });
});
