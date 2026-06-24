import {
  jsonldToText,
  buildGroundingContext,
  buildSchemaBlock,
  groundProposal,
  summarizeChange,
  RawSchemaProposal,
  SchemaBlockEntry,
} from './schema-analysis';

describe('buildSchemaBlock', () => {
  // The five managed schemas for the bug's page, in createdAt ASC order — the
  // FAQPage (newest, with 4 Q&A) is LAST, exactly where the old whole-blob
  // .slice(0, 4000) dropped it out of the prompt.
  const faqQs = ['q1', 'q2', 'q3', 'q4'];
  const managed: SchemaBlockEntry[] = [
    { label: { managedId: 'a', type: 'WebPage' }, json: { '@type': 'WebPage', name: 'W'.repeat(800) } },
    { label: { managedId: 'b', type: 'ImageObject' }, json: { '@type': 'ImageObject', url: 'u'.repeat(250) } },
    { label: { managedId: 'c', type: 'BreadcrumbList' }, json: { '@type': 'BreadcrumbList', itemListElement: 'b'.repeat(120) } },
    { label: { managedId: 'd', type: 'WebSite' }, json: { '@type': 'WebSite', name: 'S'.repeat(600) } },
    {
      label: { managedId: 'e', type: 'FAQPage' },
      json: {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqQs.map((q) => ({ '@type': 'Question', name: q })),
      },
    },
  ];

  it('keeps EVERY @type present — no schema dropped whole', () => {
    const block = buildSchemaBlock(managed);
    for (const t of ['WebPage', 'ImageObject', 'BreadcrumbList', 'WebSite', 'FAQPage']) {
      expect(block).toContain(t);
    }
  });

  it('shows every schema IN FULL with NO truncation — the bug fix', () => {
    const block = buildSchemaBlock(managed);
    // All four existing Q&A names must be visible so the model counts +1, not +4.
    for (const q of faqQs) expect(block).toContain(q);
    // Nothing is ever truncated, regardless of size.
    expect(block).not.toMatch(/truncated/);
    expect(block).toContain('W'.repeat(800)); // the largest schema is intact
  });

  it('serializes compactly (no pretty-print indentation)', () => {
    const block = buildSchemaBlock([managed[4]]);
    expect(block).not.toContain('\n  '); // no 2-space JSON indentation
  });

  it('returns empty string for no entries', () => {
    expect(buildSchemaBlock([])).toBe('');
  });
});

describe('jsonldToText', () => {
  it('collects string/number values and skips @-plumbing', () => {
    const text = jsonldToText({
      '@context': 'https://schema.org',
      '@type': 'LocalBusiness',
      '@id': 'https://x/#org',
      name: 'Poirier Agency',
      telephone: '+1 555 123',
      address: { '@type': 'PostalAddress', streetAddress: '12 King St' },
    });
    expect(text).toContain('Poirier Agency');
    expect(text).toContain('12 King St');
    expect(text).not.toContain('LocalBusiness'); // @type skipped
    expect(text).not.toContain('schema.org'); // @context skipped
  });
});

describe('summarizeChange', () => {
  const faq = (qs: string[]) => ({
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: qs.map((q) => ({ '@type': 'Question', name: q })),
  });

  it('reports the real item-count delta (FAQ 4 → 5), not the model claim', () => {
    const before = faq(['q1', 'q2', 'q3', 'q4']);
    const after = faq(['q1', 'q2', 'q3', 'q4', 'q5']);
    expect(summarizeChange(before, after)).toEqual([
      '"mainEntity": 4 → 5 items (+1)',
    ]);
  });

  it('returns empty when nothing structural changed (redundant fix)', () => {
    const same = faq(['q1', 'q2']);
    expect(summarizeChange(same, { ...same })).toEqual([]);
  });

  it('detects added / removed / changed properties', () => {
    const before = { '@type': 'LocalBusiness', name: 'A', telephone: '111' };
    const after = { '@type': 'LocalBusiness', name: 'B', address: 'X' };
    const out = summarizeChange(before, after);
    expect(out).toContain('Added "address"');
    expect(out).toContain('Removed "telephone"');
    expect(out).toContain('"name" changed');
  });

  it('flags same-length array edits', () => {
    const before = { '@type': 'FAQPage', mainEntity: [{ name: 'a' }] };
    const after = { '@type': 'FAQPage', mainEntity: [{ name: 'b' }] };
    expect(summarizeChange(before, after)).toEqual(['"mainEntity": items edited']);
  });

  it('is empty when there is no before (an add)', () => {
    expect(summarizeChange(null, faq(['q1']))).toEqual([]);
  });
});

describe('groundProposal', () => {
  const ctx = buildGroundingContext('We offer pool cleaning in Sydney. Call us today.', {
    brandName: 'Poolside',
    services: [{ name: 'Pool cleaning', subServices: ['Filter service'] }],
    locations: ['Sydney'],
    neverSay: ['pool construction'],
  });

  it('validates the JSON-LD and reports validity', () => {
    const raw: RawSchemaProposal = {
      kind: 'add',
      type: 'Service',
      jsonld: { '@context': 'https://schema.org', '@type': 'Service', name: 'Pool cleaning' },
      rationale: 'Page describes a pool cleaning service.',
    };
    const p = groundProposal(raw, ctx);
    expect(p.validation.validity).toBe('valid');
    expect(p.forbidden).toBe(false);
    expect(p.unverifiedClaims).toHaveLength(0);
    expect(p.id).toBeTruthy();
  });

  it('hard-fails when a neverSay term appears in the schema', () => {
    const raw: RawSchemaProposal = {
      kind: 'add',
      type: 'Service',
      jsonld: {
        '@context': 'https://schema.org',
        '@type': 'Service',
        name: 'Pool construction',
        description: 'Full pool construction services.',
      },
    };
    const p = groundProposal(raw, ctx);
    expect(p.forbidden).toBe(true);
    expect(p.unverifiedClaims.join(' ')).toContain('neverSay');
  });

  it('surfaces validation errors for a malformed node', () => {
    const raw: RawSchemaProposal = {
      kind: 'fix',
      type: '(no type)',
      jsonld: { '@context': 'https://schema.org', name: 'no type here' },
      targetScriptIndex: 0,
      targetNodeIndex: 1,
    };
    const p = groundProposal(raw, ctx, { '@type': 'Old' });
    expect(p.validation.validity).toBe('errors');
    expect(p.targetScriptIndex).toBe(0);
    expect(p.before).toEqual({ '@type': 'Old' });
  });
});
