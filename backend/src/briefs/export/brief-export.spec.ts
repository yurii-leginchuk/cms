import { Packer } from 'docx';
import { escapeHtml, buildBriefHtml } from './brief-html';
import { buildBriefDocx } from './brief-docx';
import { Brief } from '../brief.entity';

function makeBrief(overrides: Partial<Brief> = {}): Brief {
  return {
    id: 'b1',
    siteId: 's1',
    pageId: null,
    pageUrl: 'https://example.com/page',
    proposedMetaTitle: 'Title <with> "quotes" & ampersand',
    proposedMetaDescription: 'A description',
    proposedSlug: 'my-slug',
    proposedContent: '# Heading\n\nFirst paragraph.\n\nSecond paragraph with <tag>.',
    proposedSchema: '{"@type":"FAQPage"}',
    keywordStrategy: 'primary keyword + supporting',
    internalLinks: [{ anchor: 'Anchor <a>', targetUrl: '/target' }],
    recommendations: 'Do this & that',
    status: 'draft',
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as Brief;
}

describe('escapeHtml', () => {
  it('escapes <, >, &, and "', () => {
    expect(escapeHtml('<')).toBe('&lt;');
    expect(escapeHtml('>')).toBe('&gt;');
    expect(escapeHtml('&')).toBe('&amp;');
    expect(escapeHtml('"')).toBe('&quot;');
    expect(escapeHtml('a < b & c > "d"')).toBe('a &lt; b &amp; c &gt; &quot;d&quot;');
  });
});

describe('buildBriefHtml', () => {
  it('contains escaped fields, never raw injection', () => {
    const html = buildBriefHtml(makeBrief());
    expect(html).toContain('Title &lt;with&gt; &quot;quotes&quot; &amp; ampersand');
    expect(html).toContain('Anchor &lt;a&gt;');
    expect(html).toContain('Do this &amp; that');
    // raw unescaped angle brackets from content must not leak
    expect(html).not.toContain('<tag>');
    expect(html).toContain('&lt;tag&gt;');
  });
});

describe('buildBriefDocx', () => {
  it('packs to a non-empty Buffer', async () => {
    const doc = buildBriefDocx(makeBrief());
    const buf = await Packer.toBuffer(doc);
    expect(Buffer.from(buf).length).toBeGreaterThan(0);
  });

  it('handles a minimal brief without internal links', async () => {
    const doc = buildBriefDocx(
      makeBrief({ internalLinks: null, proposedSchema: null, keywordStrategy: null }),
    );
    const buf = await Packer.toBuffer(doc);
    expect(Buffer.from(buf).length).toBeGreaterThan(0);
  });
});
