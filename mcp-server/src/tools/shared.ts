/**
 * Shared zod fragments + a target resolver reused by the page-scoped tool
 * groups (meta / schema). Editing tools accept `siteId` (falls back to
 * CMS_DEFAULT_SITE_ID), and a page target as EITHER `pageId` OR `pageUrl`
 * (resolved against the site's page list).
 */
import { z } from 'zod';
import type { CmsClient } from '../cms-client.js';

export const siteIdField = z
  .string()
  .optional()
  .describe(
    'CMS site UUID. Falls back to CMS_DEFAULT_SITE_ID if omitted. Use list_sites to discover ids.',
  );

export const pageIdField = z
  .string()
  .optional()
  .describe('Page UUID (preferred). Use list_pages to discover ids.');

export const pageUrlField = z
  .string()
  .optional()
  .describe(
    'Page URL as an alternative to pageId; the server resolves it to a pageId (exact match preferred).',
  );

/** Resolve { siteId, pageId } from loose args (siteId default + url resolution). */
export async function resolveTarget(
  client: CmsClient,
  args: { siteId?: string; pageId?: string; pageUrl?: string },
): Promise<{ siteId: string; pageId: string }> {
  const siteId = client.resolveSiteId(args.siteId);
  const pageId = await client.resolvePageId(siteId, {
    pageId: args.pageId,
    pageUrl: args.pageUrl,
  });
  return { siteId, pageId };
}
