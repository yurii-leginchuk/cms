import { detectSchemas, extractJsonLdBlocks } from './schema-validator';

const wrap = (json: string, cls?: string) =>
  `<html><head><script type="application/ld+json"${
    cls ? ` class="${cls}"` : ''
  }>${json}</script></head><body></body></html>`;

describe('extractJsonLdBlocks', () => {
  it('pulls every ld+json block and ignores other scripts', () => {
    const html = `
      <script>var x = 1;</script>
      <script type="application/ld+json">{"@type":"WebPage"}</script>
      <script type="application/json">{"not":"ld"}</script>
      <script type="application/ld+json" class="poirier-schema">{"@type":"FAQPage"}</script>
    `;
    const blocks = extractJsonLdBlocks(html);
    expect(blocks).toHaveLength(2);
    expect(blocks[1].className).toBe('poirier-schema');
  });
});

describe('detectSchemas', () => {
  it('returns an empty result for HTML without JSON-LD', () => {
    const r = detectSchemas('<html><body><p>hi</p></body></html>');
    expect(r.summary.total).toBe(0);
    expect(r.schemas).toHaveLength(0);
    expect(r.parseErrors).toHaveLength(0);
  });

  it('validates a well-formed single node', () => {
    const r = detectSchemas(
      wrap('{"@context":"https://schema.org","@type":"Organization","name":"Acme"}'),
    );
    expect(r.summary.total).toBe(1);
    expect(r.schemas[0].validity).toBe('valid');
    expect(r.schemas[0].type).toBe('Organization');
    expect(r.summary.valid).toBe(1);
  });

  it('flattens a @graph wrapper and inherits @context', () => {
    const json = JSON.stringify({
      '@context': 'https://schema.org',
      '@graph': [
        { '@type': 'WebSite', name: 'Site' },
        { '@type': 'WebPage', name: 'Page' },
        { '@type': 'BreadcrumbList' },
      ],
    });
    const r = detectSchemas(wrap(json, 'yoast-schema-graph'));
    expect(r.summary.total).toBe(3);
    // All three inherit @context from the wrapper → no @context warning.
    expect(r.schemas.every((s) => s.validity === 'valid')).toBe(true);
    expect(r.schemas.every((s) => s.source === 'yoast')).toBe(true);
    expect(r.summary.bySource.yoast).toBe(3);
    expect(r.schemas.map((s) => s.nodeIndex)).toEqual([0, 1, 2]);
    // Wrapper @context is propagated onto each flattened node so the stored
    // schema is self-contained and validates standalone (no @context warning).
    expect(
      r.schemas.every(
        (s) => (s.json as Record<string, unknown>)['@context'] === 'https://schema.org',
      ),
    ).toBe(true);
  });

  it('flattens a top-level array', () => {
    const json = JSON.stringify([
      { '@context': 'https://schema.org', '@type': 'Article' },
      { '@context': 'https://schema.org', '@type': 'Person' },
    ]);
    const r = detectSchemas(wrap(json));
    expect(r.summary.total).toBe(2);
  });

  it('flags a missing @type as an error', () => {
    const r = detectSchemas(wrap('{"@context":"https://schema.org","name":"x"}'));
    expect(r.schemas[0].validity).toBe('errors');
    expect(r.summary.errors).toBe(1);
    expect(r.schemas[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'error', path: '@type' }),
      ]),
    );
  });

  it('warns on a missing @context', () => {
    const r = detectSchemas(wrap('{"@type":"WebPage"}'));
    expect(r.schemas[0].validity).toBe('warnings');
    expect(r.schemas[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ severity: 'warning', path: '@context' }),
      ]),
    );
  });

  it('warns on an unrecognised schema.org type', () => {
    const r = detectSchemas(
      wrap('{"@context":"https://schema.org","@type":"NotARealType"}'),
    );
    expect(r.schemas[0].validity).toBe('warnings');
    expect(r.schemas[0].issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          severity: 'warning',
          message: expect.stringContaining('Unrecognised schema.org type'),
        }),
      ]),
    );
  });

  it('records a parse error for malformed JSON without throwing', () => {
    const r = detectSchemas(wrap('{"@type":"WebPage", broken}'));
    expect(r.schemas).toHaveLength(0);
    expect(r.parseErrors).toHaveLength(1);
    expect(r.parseErrors[0].message).toContain('Invalid JSON');
  });

  it('joins array @type for display and infers poirier source', () => {
    const r = detectSchemas(
      wrap(
        '{"@context":"https://schema.org","@type":["LocalBusiness","Organization"]}',
        'poirier-schema',
      ),
    );
    expect(r.schemas[0].type).toBe('LocalBusiness, Organization');
    expect(r.schemas[0].source).toBe('poirier');
    expect(r.schemas[0].validity).toBe('valid');
  });
});
