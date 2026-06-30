import { createProposalTools } from './proposal-tools';

describe('createProposalTools.proposeMetaUpdate', () => {
  it('returns an update_meta proposal that validates clean meta', async () => {
    const tools = createProposalTools();
    const out: any = await (tools.proposeMetaUpdate as any).execute({
      pageId: 'p1',
      pageUrl: 'https://example.com/',
      currentTitle: 'Old',
      currentDescription: 'Old desc',
      proposedTitle: 'A concise, valid meta title',
      proposedDescription: 'A concise, valid meta description well under the limit.',
      reasoning: 'because the current title omits the primary keyword',
    });

    expect(out.action).toBe('update_meta');
    expect(out.type).toBe('proposal');
    expect(out.validation.valid).toBe(true);
    expect(out.validation.warnings).toHaveLength(0);
  });

  it('flags an over-length title/description', async () => {
    const tools = createProposalTools();
    const out: any = await (tools.proposeMetaUpdate as any).execute({
      pageId: 'p1',
      pageUrl: 'https://example.com/',
      currentTitle: null,
      currentDescription: null,
      proposedTitle: 'x'.repeat(70),
      proposedDescription: 'y'.repeat(200),
      reasoning: 'test',
    });

    expect(out.validation.valid).toBe(false);
    expect(out.validation.warnings).toHaveLength(2);
  });
});
