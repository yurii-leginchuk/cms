import { tool, zodSchema } from 'ai';
import { z } from 'zod';

export function createProposalTools() {
  return {
    proposeMetaUpdate: tool({
      description:
        'Propose updating meta title and/or description for a page. ALWAYS use this when suggesting meta changes instead of just describing them in text.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string(),
          pageUrl: z.string(),
          currentTitle: z.string().nullable(),
          currentDescription: z.string().nullable(),
          proposedTitle: z
            .string()
            .nullable()
            .describe('New meta title, null if not changing'),
          proposedDescription: z
            .string()
            .nullable()
            .describe('New meta description, null if not changing'),
          reasoning: z
            .string()
            .describe('Brief explanation of why these changes improve SEO'),
        }),
      ),
      execute: async (args: {
        pageId: string;
        pageUrl: string;
        currentTitle: string | null;
        currentDescription: string | null;
        proposedTitle: string | null;
        proposedDescription: string | null;
        reasoning: string;
      }) => {
        const warnings: string[] = [];
        if (args.proposedTitle && args.proposedTitle.length > 60) warnings.push(`Proposed title is ${args.proposedTitle.length} chars (recommended ≤60).`);
        if (args.proposedDescription && args.proposedDescription.length > 155) warnings.push(`Proposed description is ${args.proposedDescription.length} chars (recommended ≤155).`);
        return {
          type: 'proposal',
          action: 'update_meta',
          ...args,
          validation: { valid: warnings.length === 0, warnings },
        };
      },
    }),

    proposeNoindexChange: tool({
      description: 'Propose changing the noindex status for a page',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string(),
          pageUrl: z.string(),
          currentNoindex: z.boolean(),
          proposedNoindex: z.boolean(),
          reasoning: z.string(),
        }),
      ),
      execute: async (args: {
        pageId: string;
        pageUrl: string;
        currentNoindex: boolean;
        proposedNoindex: boolean;
        reasoning: string;
      }) => ({
        type: 'proposal',
        action: 'noindex_change',
        ...args,
      }),
    }),
  };
}
