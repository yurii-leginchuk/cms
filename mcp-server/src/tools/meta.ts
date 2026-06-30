/**
 * Meta management tools.
 *
 * HUMAN APPROVAL GATE: MCP edits do NOT take effect or publish. `meta_update`
 * stages a PENDING proposal that a human must accept in the CMS (accept =
 * applies + publishes). The publish tool (`meta_apply`) has been REMOVED — MCP
 * never publishes. `meta_generate_ai` only returns a suggestion (no persist).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CmsClient } from '../cms-client.js';
import { guard, ok, truncate } from '../util.js';
import { pageIdField, pageUrlField, resolveTarget, siteIdField } from './shared.js';

export function registerMetaTools(server: McpServer, client: CmsClient) {
  server.registerTool(
    'meta_update',
    {
      title: 'Propose a page meta change (needs human approval)',
      description:
        'Propose updating any subset of a page\'s meta/SEO fields. This does NOT take effect immediately — it stages a PENDING proposal that a human must accept in the CMS (accept = applies the change AND publishes to WordPress). Only the fields you provide change. Pass null to clear a string field. Identify the page by pageId or pageUrl.',
      inputSchema: {
        siteId: siteIdField,
        pageId: pageIdField,
        pageUrl: pageUrlField,
        customMetaTitle: z.string().max(500).nullable().optional().describe('Meta title override (null to clear).'),
        customMetaDescription: z.string().max(1000).nullable().optional().describe('Meta description override (null to clear).'),
        indexDirective: z
          .enum(['default', 'index', 'noindex'])
          .optional()
          .describe('Robots index tri-state. "default" uses the source page directive.'),
        nofollow: z.boolean().optional().describe('true = nofollow, false = follow.'),
        canonical: z.string().max(2048).nullable().optional().describe('Canonical URL (null to clear).'),
        ogTitle: z.string().max(500).nullable().optional().describe('Open Graph title.'),
        ogDescription: z.string().max(1000).nullable().optional().describe('Open Graph description.'),
        ogImage: z.string().max(2048).nullable().optional().describe('Open Graph image URL (e.g. from upload_image).'),
        ogImageId: z.number().int().nullable().optional().describe('WordPress attachment id for the OG image.'),
        isTransactional: z.boolean().optional().describe('Mark the page as transactional/commercial intent.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const payload: Record<string, unknown> = {};
        const keys = [
          'customMetaTitle',
          'customMetaDescription',
          'indexDirective',
          'nofollow',
          'canonical',
          'ogTitle',
          'ogDescription',
          'ogImage',
          'ogImageId',
          'isTransactional',
        ] as const;
        for (const k of keys) {
          if ((args as any)[k] !== undefined) payload[k] = (args as any)[k];
        }
        if (Object.keys(payload).length === 0) {
          return ok('No meta fields provided — nothing proposed.', { proposed: false });
        }
        const change = await client.createChange(siteId, {
          module: 'meta',
          action: 'meta.update',
          targetType: 'page',
          targetId: pageId,
          payload,
        });
        return ok(
          `Proposed change #${change.id} — "${change.summary}" — awaiting human approval in the CMS. It will NOT take effect until a human accepts it.`,
          { proposal: change },
        );
      }),
  );

  server.registerTool(
    'meta_generate_ai',
    {
      title: 'AI-suggest page meta (suggestion only)',
      description:
        'COSTS AI TOKENS: generate a grounded meta title + description suggestion for the page. Returns the suggestion only — it does NOT persist or publish. To apply it, call meta_update with the chosen values (which stages a proposal for human approval).',
      inputSchema: {
        siteId: siteIdField,
        pageId: pageIdField,
        pageUrl: pageUrlField,
        promptSlug: z.string().optional().describe('Optional prompt template slug.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const res = await client.post(`/sites/${siteId}/pages/${pageId}/generate-meta`, {
          promptSlug: args.promptSlug,
        });
        return ok(
          `AI meta suggestion (not persisted). Review and propose via meta_update to apply.`,
          { suggestion: res as Record<string, unknown> },
        );
      }),
  );

  server.registerTool(
    'meta_history',
    {
      title: 'Get page meta change history',
      description: 'Read-only: list the recorded meta change history for a page (field, old → new).',
      inputSchema: { siteId: siteIdField, pageId: pageIdField, pageUrl: pageUrlField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const history = (await client.get(`/sites/${siteId}/pages/${pageId}/history`)) as any[];
        const rows = (history || []).slice(0, 50).map((h: any) => ({
          field: h.field,
          oldValue: typeof h.oldValue === 'string' ? truncate(h.oldValue, 120) : h.oldValue,
          newValue: typeof h.newValue === 'string' ? truncate(h.newValue, 120) : h.newValue,
          createdAt: h.createdAt,
        }));
        return ok(
          `${rows.length} history entr${rows.length === 1 ? 'y' : 'ies'} (latest first shown up to 50).`,
          { history: rows },
        );
      }),
  );
}
