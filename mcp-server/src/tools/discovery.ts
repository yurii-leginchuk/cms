/**
 * Discovery + read tools: find sites/pages and read current state before
 * editing, plus a local-file image upload.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CmsClient } from '../cms-client.js';
import { guard, ok, pageMetaSummary, slimPage } from '../util.js';
import { siteIdField } from './shared.js';

export function registerDiscoveryTools(server: McpServer, client: CmsClient) {
  server.registerTool(
    'list_sites',
    {
      title: 'List CMS sites',
      description:
        'List all sites in the CMS (id, name, url, pagesCount, status). Read-only. Use this first to find the siteId for the other tools.',
      inputSchema: {},
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      guard(async () => {
        const sites = await client.listSites();
        const rows = sites.map((s: any) => ({
          id: s.id,
          name: s.name,
          url: s.url,
          pagesCount: s.pagesCount,
          status: s.status,
        }));
        const text =
          `${rows.length} site(s):\n` +
          rows.map((s) => `- ${s.name}  [${s.id}]  ${s.url}  (${s.pagesCount} pages)`).join('\n');
        return ok(text, { sites: rows });
      }),
  );

  server.registerTool(
    'list_pages',
    {
      title: 'List pages for a site',
      description:
        'List a site\'s pages with a one-line meta summary each (id, url, title, index/follow flags, sync status). Read-only. Supports search + pagination. rawHtml/content are stripped.',
      inputSchema: {
        siteId: siteIdField,
        search: z.string().optional().describe('Filter by URL substring.'),
        page: z.number().int().min(1).optional().describe('Page number (default 1).'),
        limit: z.number().int().min(1).max(200).optional().describe('Page size (default 50, max 200).'),
        sort: z
          .enum(['url_asc', 'transactional_first', 'custom_first', 'modified_desc'])
          .optional()
          .describe('Sort order (default url_asc).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const res = await client.listPages(siteId, {
          search: args.search,
          page: args.page,
          limit: args.limit,
          sort: args.sort,
        });
        const pages = (res.data || []).map((p) => ({
          id: p.id,
          url: p.url,
          metaTitle: p.customMetaTitle ?? p.metaTitle ?? null,
          indexDirective: p.indexDirective ?? null,
          nofollow: p.nofollow ?? null,
          syncStatus: p.syncStatus ?? null,
        }));
        const text =
          `${res.meta.total} page(s) total — showing ${pages.length} (page ${res.meta.page}/${res.meta.totalPages}):\n` +
          (res.data || []).map((p) => `- [${p.id}] ${pageMetaSummary(p)}`).join('\n');
        return ok(text, { pages, meta: res.meta });
      }),
  );

  server.registerTool(
    'get_page',
    {
      title: 'Get full meta state of a page',
      description:
        'Get the full meta/SEO state of a single page (all meta + OG + robots fields + sync status). Read-only. Identify the page by pageId or pageUrl. Heavy fields (rawHtml/content) are stripped.',
      inputSchema: {
        siteId: siteIdField,
        pageId: z.string().optional().describe('Page UUID.'),
        pageUrl: z.string().optional().describe('Page URL (resolved to a pageId).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const pageId = await client.resolvePageId(siteId, {
          pageId: args.pageId,
          pageUrl: args.pageUrl,
        });
        const page = await client.getPage(siteId, pageId);
        const slim = slimPage(page as Record<string, any>);
        return ok(
          `Page ${page.url}\n` +
            `  title: ${page.customMetaTitle ?? page.metaTitle ?? '(none)'}\n` +
            `  description: ${page.customMetaDescription ?? page.metaDescription ?? '(none)'}\n` +
            `  index: ${page.indexDirective ?? 'default'} | nofollow: ${page.nofollow ?? false} | canonical: ${page.canonical ?? '(none)'}\n` +
            `  og: title="${page.ogTitle ?? ''}" desc="${page.ogDescription ?? ''}" image=${page.ogImage ?? '(none)'}\n` +
            `  sync: ${page.syncStatus ?? 'unknown'}${page.syncError ? ` (error: ${page.syncError})` : ''}`,
          { page: slim },
        );
      }),
  );

  server.registerTool(
    'upload_image',
    {
      title: 'Upload a local image to WordPress media',
      description:
        'SIDE EFFECT: reads a local image file from disk and uploads it to the site\'s WordPress media library, returning {id,url,width,height}. Use the returned url/id with meta_update (ogImage/ogImageId) to set an Open Graph image.',
      inputSchema: {
        siteId: siteIdField,
        filePath: z.string().describe('Absolute path to a local image file on this machine.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const r = await client.uploadImage(siteId, args.filePath);
        return ok(
          `Uploaded to WordPress media: id=${r.id} url=${r.url} (${r.width ?? '?'}x${r.height ?? '?'}, ${r.mime}).`,
          { upload: r },
        );
      }),
  );
}
