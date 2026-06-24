import {
  validateProposedContent,
  validateRecommendations,
  checkFaithfulness,
  RecommendationInput,
} from './proposal-validation';

const goodContent = `# Main Heading

Real production-ready intro paragraph that says something useful.

## A section

More real copy here.`;

const baseValid = {
  proposedMetaTitle: 'Great SEO Services for B2B Brands | Agency',
  proposedMetaDescription:
    'Data-driven SEO for B2B companies: technical audits, content strategy, and link building that grow qualified organic traffic fast.',
  proposedContent: goodContent,
  proposedSchema: '{"@context":"https://schema.org","@type":"FAQPage"}',
  internalLinks: [
    { anchor: 'a', targetUrl: '/1' },
    { anchor: 'b', targetUrl: '/2' },
    { anchor: 'c', targetUrl: '/3' },
  ],
};

describe('validateProposedContent', () => {
  it('passes a well-formed proposal with no warnings', () => {
    const v = validateProposedContent(baseValid);
    expect(v.valid).toBe(true);
    expect(v.warnings).toHaveLength(0);
    expect(v.schemaValid).toBe(true);
  });

  it('flags a too-long meta title', () => {
    const v = validateProposedContent({ ...baseValid, proposedMetaTitle: 'x'.repeat(70) });
    expect(v.valid).toBe(false);
    expect(v.warnings.some((w) => w.includes('Meta title is 70'))).toBe(true);
  });

  it('flags a too-long meta description', () => {
    const v = validateProposedContent({ ...baseValid, proposedMetaDescription: 'y'.repeat(160) });
    expect(v.warnings.some((w) => w.includes('Meta description is 160'))).toBe(true);
  });

  it('flags placeholder text in the content', () => {
    const v = validateProposedContent({
      ...baseValid,
      proposedContent: '# Title\n\n[Proposed content would go here]',
    });
    expect(v.warnings.some((w) => w.toLowerCase().includes('placeholder'))).toBe(true);
  });

  it('flags content without an H1', () => {
    const v = validateProposedContent({ ...baseValid, proposedContent: 'No heading here, just text.' });
    expect(v.warnings.some((w) => w.includes('H1'))).toBe(true);
  });

  it('flags invalid JSON-LD schema', () => {
    const v = validateProposedContent({ ...baseValid, proposedSchema: '{ not valid json' });
    expect(v.schemaValid).toBe(false);
    expect(v.warnings.some((w) => w.includes('proposedSchema'))).toBe(true);
  });

  it('treats a null/empty schema as not-applicable (schemaValid null)', () => {
    const v = validateProposedContent({ ...baseValid, proposedSchema: null });
    expect(v.schemaValid).toBeNull();
  });

  it('flags fewer than 3 internal links', () => {
    const v = validateProposedContent({ ...baseValid, internalLinks: [{ anchor: 'a', targetUrl: '/1' }] });
    expect(v.warnings.some((w) => w.includes('internal links'))).toBe(true);
  });
});

const goodRec: RecommendationInput = {
  evidence: { metric: '111 impressions at pos 8.2', source: 'gsc', dateRange: '2026-03-15..2026-06-12' },
  reasoning: 'because the page is an intent mismatch capping it at pos 8.2',
  action: { type: 'new_page', targetUrl: '/cape-town-seo/', anchorText: null, sourcePage: null },
  expectedImpact: { estimate: 'pos 8.2 → top-3 on 111 impressions', label: 'calculated' },
};

describe('validateRecommendations', () => {
  it('passes a fully-grounded recommendation', () => {
    expect(validateRecommendations([goodRec]).valid).toBe(true);
  });

  it('rejects an empty list', () => {
    expect(validateRecommendations([]).valid).toBe(false);
  });

  it('rejects evidence with no number', () => {
    const v = validateRecommendations([{ ...goodRec, evidence: { ...goodRec.evidence, metric: 'lots of impressions' } }]);
    expect(v.warnings.some((w) => w.includes('evidence.metric'))).toBe(true);
  });

  it('rejects reasoning without "because"', () => {
    const v = validateRecommendations([{ ...goodRec, reasoning: 'it is an intent mismatch' }]);
    expect(v.warnings.some((w) => w.includes('reasoning'))).toBe(true);
  });

  it('rejects an abstract action target', () => {
    const v = validateRecommendations([{ ...goodRec, action: { ...goodRec.action, targetUrl: 'create dedicated pages' } }]);
    expect(v.warnings.some((w) => w.includes('action.targetUrl'))).toBe(true);
  });

  it('requires anchor + source page for internal_link actions', () => {
    const v = validateRecommendations([{ ...goodRec, action: { type: 'internal_link', targetUrl: '/x/', anchorText: null, sourcePage: null } }]);
    expect(v.warnings.some((w) => w.includes('internal_link'))).toBe(true);
  });

  it('rejects a "calculated" label with no number in the estimate', () => {
    const v = validateRecommendations([{ ...goodRec, expectedImpact: { estimate: 'a big improvement', label: 'calculated' } }]);
    expect(v.warnings.some((w) => w.includes('expectedImpact'))).toBe(true);
  });
});

describe('checkFaithfulness', () => {
  const ctx = {
    sourceContent: 'We offer SEO and PPC. Our SEO includes technical SEO and local SEO.',
    retrievedContent: [],
    brandServices: ['SEO', 'PPC', 'Technical SEO', 'Local SEO'],
    brandNeverSay: ['Website Development', 'Front-End Development'],
  };

  it('passes a draft that only references real services', () => {
    const content = '# SEO Services\n\n## SEO\n- Technical SEO\n- Local SEO\n\n## PPC\nGoogle Ads management.';
    const r = checkFaithfulness(content, ctx);
    expect(r.faithful).toBe(true);
    expect(r.forbiddenHits).toHaveLength(0);
  });

  it('hard-fails when a never-say offering is present', () => {
    const content = '# Our Services\n\n## Website Development\n- Front-End Development\n- Back-End Development';
    const r = checkFaithfulness(content, ctx);
    expect(r.faithful).toBe(false);
    expect(r.forbiddenHits.length).toBeGreaterThan(0);
  });

  it('flags an ungrounded offering as unsupported (advisory)', () => {
    const content = '# SEO Services\n\n## SEO\n- Technical SEO\n\n## Email Marketing Automation\nWe do this too.';
    const r = checkFaithfulness(content, ctx);
    expect(r.unsupportedOfferings.some((o) => /email marketing/i.test(o))).toBe(true);
  });

  it('does not flag generic section headings', () => {
    const content = '# SEO Services\n\n## SEO\n- Technical SEO\n\n## FAQ\n## Why Choose Us\n## Contact';
    const r = checkFaithfulness(content, ctx);
    expect(r.unsupportedOfferings).toHaveLength(0);
  });
});
