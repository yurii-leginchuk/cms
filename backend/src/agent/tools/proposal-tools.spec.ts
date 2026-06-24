import { Repository } from 'typeorm';
import { createProposalTools } from './proposal-tools';
import { Brief } from '../../briefs/brief.entity';

describe('createProposalTools.proposePageContent', () => {
  const validArgs = {
    pageId: null,
    pageUrl: 'https://example.com/new',
    proposedMetaTitle: 'A solid SEO meta title for the page | Brand',
    proposedMetaDescription:
      'A genuinely useful meta description that summarizes the page and stays well under the recommended length limit.',
    proposedSlug: 'new-page',
    proposedContent:
      '# Heading\n\nReal production-ready intro paragraph.\n\n## Section\n\nMore real copy.',
    proposedSchema: '{"@context":"https://schema.org","@type":"FAQPage"}',
    keywordStrategy: 'primary keyword + supporting terms',
    internalLinks: [
      { anchor: 'a', targetUrl: '/1' },
      { anchor: 'b', targetUrl: '/2' },
      { anchor: 'c', targetUrl: '/3' },
    ],
    recommendations: [
      {
        evidence: { metric: '111 impressions at pos 8.2', source: 'gsc' as const, dateRange: '2026-03-15..2026-06-12' },
        reasoning: 'because the page is an intent mismatch capping it at pos 8.2',
        action: { type: 'new_page' as const, targetUrl: '/cape-town-seo/', anchorText: null, sourcePage: null },
        expectedImpact: { estimate: 'pos 8.2 → top-3 on 111 impressions', label: 'calculated' as const },
      },
    ],
  };

  it('persists a draft brief and returns briefId + action content_proposal', async () => {
    const save = jest.fn().mockResolvedValue({ id: 'b1' });
    const create = jest.fn().mockImplementation((x) => x);
    const repo = { create, save } as unknown as Repository<Brief>;

    const tools = createProposalTools(repo, 'site-123');
    const out: any = await (tools.proposePageContent as any).execute(validArgs);

    expect(create).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(1);
    // create called with siteId + status draft + the args
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ siteId: 'site-123', status: 'draft', pageUrl: validArgs.pageUrl }),
    );

    expect(out.action).toBe('content_proposal');
    expect(out.type).toBe('proposal');
    expect(out.briefId).toBe('b1');
    expect(out.validation).toBeDefined();
  });
});

describe('createProposalTools.openBriefForEditing', () => {
  it('returns an open_brief navigation action with siteId from closure', async () => {
    const repo = { create: jest.fn(), save: jest.fn() } as unknown as Repository<Brief>;
    const tools = createProposalTools(repo, 'site-xyz');
    const out: any = await (tools.openBriefForEditing as any).execute({ briefId: 'b9' });
    expect(out.action).toBe('open_brief');
    expect(out.type).toBe('navigation');
    expect(out.briefId).toBe('b9');
    expect(out.siteId).toBe('site-xyz');
  });
});
