/**
 * ALT-text tools.
 *
 * HUMAN APPROVAL GATE: `alt_set` stages a PENDING proposal that a human must
 * accept in the CMS (accept = sets the alt AND publishes to WordPress). The
 * publishing / autopilot tools (alt_apply, alt_apply_all, alt_autopilot) and the
 * direct draft-state tools (alt_approve, alt_revert, alt_generate_missing) have
 * been REMOVED — MCP never publishes and never mutates publishable draft state
 * outside the approval queue. `alt_generate` returns a grounded AI suggestion
 * (held as a non-auto-published ai_suggested draft); apply it via `alt_set`.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CmsClient } from '../cms-client.js';
import { guard, jsonCap, ok, truncate } from '../util.js';
import { siteIdField } from './shared.js';

const imageIdField = z.string().describe('Image UUID (from alt_list).');

function summariseImage(i: any) {
  return {
    id: i.id,
    url: truncate(String(i.canonicalUrl ?? i.url ?? i.src ?? ''), 160),
    alt: i.draftAlt ?? i.alt ?? null,
    status: i.status,
  };
}

export function registerAltTools(server: McpServer, client: CmsClient) {
  const siteBase = (siteId: string) => `/sites/${siteId}/images`;

  server.registerTool(
    'alt_list',
    {
      title: 'List images (alt text)',
      description:
        'Read-only: paginated image library for a site with alt text + review status. Use missingOnly to focus on images lacking alt. URLs truncated for readability.',
      inputSchema: {
        siteId: siteIdField,
        page: z.number().int().min(1).optional().describe('Page number (default 1).'),
        limit: z.number().int().min(1).max(100).optional().describe('Page size (default 25, max 100).'),
        missingOnly: z.boolean().optional().describe('Only images missing alt text.'),
        search: z.string().optional().describe('Filter by URL/filename substring.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const res = (await client.get(siteBase(siteId), {
          page: args.page ?? 1,
          limit: args.limit ?? 25,
          missingOnly: args.missingOnly ? 'true' : 'false',
          search: args.search ?? '',
        })) as any;
        const list = res?.data ?? res?.items ?? res ?? [];
        const meta = res?.meta;
        const rows = (Array.isArray(list) ? list : []).map(summariseImage);
        return ok(
          `${meta?.total ?? rows.length} image(s)${meta ? ` (page ${meta.page}/${meta.totalPages})` : ''}:\n` +
            rows.map((r) => `- [${r.id}] ${r.alt ? `"${truncate(r.alt, 60)}"` : '(no alt)'} ${r.status ? `(${r.status})` : ''} ${r.url}`).join('\n'),
          { images: rows, meta },
        );
      }),
  );

  server.registerTool(
    'alt_coverage',
    {
      title: 'Site alt-text coverage',
      description: 'Read-only: honest alt-text coverage stats for the site (per-image + per-placement, with freshness).',
      inputSchema: { siteId: siteIdField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const res = (await client.get(`${siteBase(siteId)}/coverage`)) as any;
        return ok(`Alt coverage:\n${truncate(jsonCap(res, 3000), 1500)}`, { coverage: res });
      }),
  );

  server.registerTool(
    'alt_reconcile',
    {
      title: 'Reconcile image library',
      description:
        'Re-derive the image library from every scraped page (CMS-side; no WordPress write, no AI, no alt-text change). Run after a site parse.',
      inputSchema: { siteId: siteIdField },
      annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const res = (await client.post(`${siteBase(siteId)}/reconcile`)) as any;
        return ok(`Reconcile complete.\n${truncate(jsonCap(res, 2000), 1000)}`, { result: res });
      }),
  );

  server.registerTool(
    'alt_generate',
    {
      title: 'AI-suggest alt for one image (suggestion only)',
      description:
        'COSTS AI TOKENS: generate one grounded AI alt SUGGESTION for an image. It does NOT publish (it leaves a non-auto-published ai_suggested draft in the CMS). To actually change the live alt, propose the text via alt_set (which stages a proposal for human approval).',
      inputSchema: { siteId: siteIdField, imageId: imageIdField },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const res = (await client.post(`${siteBase(siteId)}/${args.imageId}/generate`)) as any;
        const suggested = res?.draftAlt ?? res?.alt ?? '';
        return ok(
          `AI alt suggestion for image ${args.imageId}: "${truncate(String(suggested), 200)}". Propose via alt_set to apply (human approval required).`,
          { suggestion: summariseImage(res ?? {}) },
        );
      }),
  );

  server.registerTool(
    'alt_set',
    {
      title: 'Propose an ALT text change (needs human approval)',
      description:
        'Propose setting an image\'s ALT text. Does NOT take effect immediately — stages a PENDING proposal a human must accept in the CMS (accept = sets the alt AND publishes it to the WordPress attachment).',
      inputSchema: {
        siteId: siteIdField,
        imageId: imageIdField,
        alt: z.string().describe('The proposed alt text (empty string clears it).'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const change = await client.createChange(siteId, {
          module: 'alt',
          action: 'alt.set',
          targetType: 'image',
          targetId: args.imageId,
          payload: { alt: args.alt },
        });
        return ok(
          `Proposed change #${change.id} — "${change.summary}" — awaiting human approval in the CMS.`,
          { proposal: change },
        );
      }),
  );
}
