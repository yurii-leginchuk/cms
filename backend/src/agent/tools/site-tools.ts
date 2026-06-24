import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { Repository } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { Site } from '../../sites/site.entity';
import { Page } from '../../pages/page.entity';
import { SiteBrief } from '../../sites/site-brief.entity';
import { BrandCard } from '../../sites/brand-card.entity';
import { evidenceFor } from '../evidence/evidence';
import { PageSpeedResult } from '../../pagespeed/page-speed-result.entity';
import { EmbeddingService } from '../../embedding/embedding.service';
import { GscService, resolveDateRange } from '../../gsc/gsc.service';
import { detectCannibalization } from '../../impact/cannibalization';
import { SettingsService } from '../../settings/settings.service';

/**
 * Server-side aggregation of GSC rows into authoritative totals.
 * Computed over the FULL result set so the model never hand-sums rows in-context
 * (which it does inconsistently — see Defect D-A). CTR and average position are
 * impression-weighted, matching how GSC itself aggregates.
 */
export function computeGscTotals(
  rows: Array<{ clicks: number; impressions: number; position: number }>,
): { clicks: number; impressions: number; ctr: number; avgPosition: number } {
  let clicks = 0;
  let impressions = 0;
  let weightedPosition = 0;
  for (const r of rows) {
    clicks += r.clicks;
    impressions += r.impressions;
    weightedPosition += r.position * r.impressions;
  }
  return {
    clicks,
    impressions,
    // CTR as a percentage of impressions (matches the per-row ctr*100 display)
    ctr: impressions > 0 ? +((clicks / impressions) * 100).toFixed(2) : 0,
    // Impression-weighted average position over the full set
    avgPosition: impressions > 0 ? +(weightedPosition / impressions).toFixed(1) : 0,
  };
}

async function fetchPsiAudit(url: string, strategy: string, settingsService: SettingsService) {
  const apiKey = await settingsService.getRaw('psi_api_key');
  if (!apiKey) return { url, error: 'No PSI API key configured.' };

  let data: any;
  try {
    const res = await axios.get('https://www.googleapis.com/pagespeedonline/v5/runPagespeed', {
      params: { url, strategy, category: 'performance', key: apiKey },
      timeout: 60_000,
    });
    data = res.data;
  } catch (err) {
    const msg = err instanceof AxiosError ? (err.response?.data?.error?.message ?? err.message) : String(err);
    return { url, error: `PSI error: ${msg}` };
  }

  const lh = data?.lighthouseResult;
  const score = Math.round((lh?.categories?.performance?.score ?? 0) * 100);
  const audits = lh?.audits ?? {};

  const failing = Object.values(audits)
    .filter((a: any) => a.score !== null && a.score < 0.9 && a.details?.type !== 'debugdata')
    .sort((a: any, b: any) => (a.score ?? 1) - (b.score ?? 1))
    .slice(0, 10)
    .map((a: any) => ({
      id: a.id,
      title: a.title,
      score: a.score != null ? Math.round(a.score * 100) : null,
      description: a.description?.split('\n')[0]?.replace(/\[Learn more[^\]]*\]/g, '').trim(),
      savingsMs: a.details?.overallSavingsMs ? Math.round(a.details.overallSavingsMs) : null,
      displayValue: a.displayValue ?? null,
    }));

  return {
    url,
    score,
    coreWebVitals: {
      lcp: audits['largest-contentful-paint']?.displayValue ?? null,
      fcp: audits['first-contentful-paint']?.displayValue ?? null,
      cls: audits['cumulative-layout-shift']?.displayValue ?? null,
      tbt: audits['total-blocking-time']?.displayValue ?? null,
    },
    failingAudits: failing,
  };
}

export function createSiteTools(
  siteRepo: Repository<Site>,
  pageRepo: Repository<Page>,
  siteId: string,
  embeddingService: EmbeddingService,
  gscService: GscService,
  psiRepo: Repository<PageSpeedResult>,
  settingsService: SettingsService,
  briefRepo: Repository<SiteBrief>,
  brandCardRepo: Repository<BrandCard>,
) {
  // Shared date formatter
  const fmtDate = (d: Date) => {
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  };
  return {
    getSiteInfo: tool({
      description: 'Get basic information about the current site',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const site = await siteRepo.findOne({ where: { id: siteId } });
        if (!site) return { error: 'Site not found' };
        return {
          name: site.name,
          url: site.url,
          pagesTotal: site.pagesTotal,
          pagesProcessed: site.pagesProcessed,
          status: site.status,
          lastParsedAt: site.lastParsedAt,
        };
      },
    }),

    getSiteStats: tool({
      description:
        'Get SEO statistics for the site: pages counts, missing meta, noindex, sync status',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const total = await pageRepo.count({ where: { siteId } });
        const withCustomTitle = await pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .andWhere('p.customMetaTitle IS NOT NULL')
          .getCount();
        const withCustomDesc = await pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .andWhere('p.customMetaDescription IS NOT NULL')
          .getCount();
        const noindex = await pageRepo.count({
          where: { siteId, noindex: true },
        });
        const synced = await pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .andWhere("p.syncStatus = 'synced'")
          .getCount();
        const transactional = await pageRepo.count({
          where: { siteId, isTransactional: true },
        });
        const missingTitle = await pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .andWhere('p.customMetaTitle IS NULL')
          .andWhere('p.metaTitle IS NULL')
          .getCount();
        const missingDesc = await pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .andWhere('p.customMetaDescription IS NULL')
          .andWhere('p.metaDescription IS NULL')
          .getCount();

        return {
          total,
          withCustomTitle,
          withCustomDescription: withCustomDesc,
          noindex,
          synced,
          transactional,
          missingTitle,
          missingDescription: missingDesc,
        };
      },
    }),

    getPages: tool({
      description: 'Get a list of pages for the site with optional filtering. Use urlContains to filter by URL pattern, e.g. "/author/" for author pages, "/blog/" for blog posts, "/services/" for service pages.',
      inputSchema: zodSchema(
        z.object({
          filter: z
            .enum([
              'all',
              'missing_title',
              'missing_description',
              'missing_meta',
              'noindex',
              'transactional',
              'not_synced',
            ])
            .optional()
            .default('all'),
          urlContains: z.string().optional().describe('Filter pages whose URL contains this string, e.g. "/author/", "/blog/", "/services/"'),
          limit: z.number().int().min(1).max(200).optional().default(20),
          orderBy: z
            .enum(['url', 'updated_desc'])
            .optional()
            .default('url'),
        }),
      ),
      execute: async (input: {
        filter: 'all' | 'missing_title' | 'missing_description' | 'missing_meta' | 'noindex' | 'transactional' | 'not_synced';
        urlContains?: string;
        limit: number;
        orderBy: 'url' | 'updated_desc';
      }) => {
        const { filter, limit, orderBy, urlContains } = input;
        let qb = pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .select([
            'p.id',
            'p.url',
            'p.metaTitle',
            'p.customMetaTitle',
            'p.metaDescription',
            'p.customMetaDescription',
            'p.isTransactional',
            'p.noindex',
            'p.syncStatus',
          ]);

        if (urlContains) {
          qb = qb.andWhere('p.url ILIKE :urlPattern', { urlPattern: `%${urlContains}%` });
        }

        switch (filter) {
          case 'missing_title':
            qb = qb
              .andWhere('p.customMetaTitle IS NULL')
              .andWhere('p.metaTitle IS NULL');
            break;
          case 'missing_description':
            qb = qb
              .andWhere('p.customMetaDescription IS NULL')
              .andWhere('p.metaDescription IS NULL');
            break;
          case 'missing_meta':
            qb = qb.andWhere(
              '(p.customMetaTitle IS NULL AND p.metaTitle IS NULL) OR (p.customMetaDescription IS NULL AND p.metaDescription IS NULL)',
            );
            break;
          case 'noindex':
            qb = qb.andWhere('p.noindex = true');
            break;
          case 'transactional':
            qb = qb.andWhere('p.isTransactional = true');
            break;
          case 'not_synced':
            qb = qb.andWhere("p.syncStatus != 'synced'");
            break;
        }

        if (orderBy === 'updated_desc') {
          qb = qb.orderBy('p.updatedAt', 'DESC');
        } else {
          qb = qb.orderBy('p.url', 'ASC');
        }

        const pages = await qb.limit(limit).getMany();

        return pages.map((p) => ({
          id: p.id,
          url: p.url,
          metaTitle: p.metaTitle,
          customMetaTitle: p.customMetaTitle,
          metaDescription: p.metaDescription,
          customMetaDescription: p.customMetaDescription,
          isTransactional: p.isTransactional,
          noindex: p.noindex,
          syncStatus: p.syncStatus,
        }));
      },
    }),

    getPage: tool({
      description: 'Get full details of a specific page including its content',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().describe('The page ID'),
        }),
      ),
      execute: async (input: { pageId: string }) => {
        const page = await pageRepo.findOne({
          where: { id: input.pageId, siteId },
        });
        if (!page) return { error: 'Page not found' };
        return {
          url: page.url,
          metaTitle: page.metaTitle,
          customMetaTitle: page.customMetaTitle,
          metaDescription: page.metaDescription,
          customMetaDescription: page.customMetaDescription,
          cleanContent: page.cleanContent ?? null,
          noindex: page.noindex,
          canonical: page.canonical,
          isTransactional: page.isTransactional,
          syncStatus: page.syncStatus,
        };
      },
    }),

    getPageByUrl: tool({
      description: 'Find a page by its exact URL. Use this when the user references a specific page URL.',
      inputSchema: zodSchema(
        z.object({
          url: z.string().describe('The full page URL to look up'),
        }),
      ),
      execute: async (input: { url: string }) => {
        // Strip query params and hash (UTM params etc.) before lookup
        let cleanUrl = input.url;
        try {
          const u = new URL(input.url);
          u.search = '';
          u.hash = '';
          cleanUrl = u.toString();
        } catch { /* keep original */ }

        const page = await pageRepo.findOne({
          where: { url: cleanUrl, siteId },
        });
        if (!page) {
          // Try with/without trailing slash
          const alt = cleanUrl.endsWith('/')
            ? cleanUrl.slice(0, -1)
            : cleanUrl + '/';
          const altPage = await pageRepo.findOne({
            where: { url: alt, siteId },
          });
          if (!altPage) return { error: `No page found with URL: ${input.url}` };
          return {
            id: altPage.id,
            url: altPage.url,
            metaTitle: altPage.metaTitle,
            customMetaTitle: altPage.customMetaTitle,
            metaDescription: altPage.metaDescription,
            customMetaDescription: altPage.customMetaDescription,
            cleanContent: altPage.cleanContent ?? null,
            noindex: altPage.noindex,
            isTransactional: altPage.isTransactional,
            syncStatus: altPage.syncStatus,
          };
        }
        return {
          id: page.id,
          url: page.url,
          metaTitle: page.metaTitle,
          customMetaTitle: page.customMetaTitle,
          metaDescription: page.metaDescription,
          customMetaDescription: page.customMetaDescription,
          cleanContent: page.cleanContent ?? null,
          noindex: page.noindex,
          isTransactional: page.isTransactional,
          syncStatus: page.syncStatus,
        };
      },
    }),

    querySearchConsole: tool({
      description: `Query Google Search Console data for this site.
Returns clicks, impressions, CTR, and position.

Date presets: last_7_days | last_28_days | last_3_months | this_month | last_month | last_quarter | last_year
Or exact: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }

Dimensions: query, page, country, device, date

For period comparisons call this tool twice with different dateRange values.
For trend over time use dimensions: ["date"].
Rows are capped at 1000; use rowLimit to control response size.

The response includes a server-computed \`totals\` object (clicks, impressions, impression-weighted CTR and average position) over the FULL result set. ALWAYS report totals/splits from \`totals\` — never hand-sum the rows yourself.

Filters are OPTIONAL. Do NOT add a filter unless you need to restrict to a specific page/query/country/device. For whole-site analysis (e.g. CTR-outlier pages), query with dimensions:["page"] and NO filter, then sort/threshold in your answer. A filter expression must be non-empty.`,
      inputSchema: zodSchema(
        z.object({
          dateRange: z.union([
            z.enum(['last_7_days', 'last_28_days', 'last_3_months', 'this_month', 'last_month', 'last_quarter', 'last_year']),
            z.object({ start: z.string(), end: z.string() }),
          ]).describe('Date range preset or exact {start, end}'),
          dimensions: z
            .array(z.enum(['query', 'page', 'country', 'device', 'date']))
            .optional()
            .describe('Group results by these dimensions'),
          rowLimit: z.number().int().min(1).max(1000).optional().default(50),
          filters: z
            .array(
              z.object({
                dimension: z.enum(['query', 'page', 'country', 'device']),
                operator: z.enum(['equals', 'notEquals', 'contains', 'notContains', 'includingRegex', 'excludingRegex']),
                expression: z.string().min(1, 'Filter expression must be non-empty — omit the filter entirely for whole-site queries'),
              }),
            )
            .optional()
            .describe('Filter rows, e.g. filter by specific page or query'),
          searchType: z.enum(['web', 'image', 'video', 'news']).optional().default('web'),
        }),
      ),
      execute: async (input: any) => {
        try {
          const { startDate, endDate } = resolveDateRange(input.dateRange);
          // Defensive: drop any degenerate filter with an empty expression before
          // calling GSC. A no-op filter (e.g. `page notContains ""`) silently
          // returns 0 rows and leads to confidently-wrong "no data" answers (D-B).
          const filters = Array.isArray(input.filters)
            ? input.filters.filter(
                (f: any) => typeof f?.expression === 'string' && f.expression.trim() !== '',
              )
            : input.filters;
          const result = await gscService.query(siteId, {
            startDate,
            endDate,
            dimensions: input.dimensions,
            rowLimit: input.rowLimit ?? 50,
            filters,
            searchType: input.searchType ?? 'web',
          });
          const rows = result.rows ?? [];
          // Authoritative server-computed totals over the FULL row set (D-A).
          // The model MUST report totals/splits from this — never hand-sum rows.
          const totals = computeGscTotals(rows);
          return {
            dateRange: { startDate, endDate },
            rowCount: rows.length,
            _cached: result._cached ?? false,
            totals,
            rows: rows.map((r) => ({
              keys: r.keys,
              clicks: r.clicks,
              impressions: r.impressions,
              ctr: +(r.ctr * 100).toFixed(2),
              position: +r.position.toFixed(1),
            })),
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),

    findStrikingDistanceKeywords: tool({
      description:
        'Site-wide SEO quick-win finder. Scans Google Search Console across the ENTIRE site for keywords ranking in "striking distance" (positions 4-20) that already get impressions but few clicks — the highest-ROI opportunities to optimize first. ' +
        'Use for: "where are my biggest opportunities", "what should I optimize first", "show me quick wins", "low-hanging fruit", "what to prioritize".',
      inputSchema: zodSchema(z.object({
        dateRange: z.union([
          z.enum(['last_7_days', 'last_28_days', 'last_3_months', 'this_month', 'last_month', 'last_quarter', 'last_year']),
          z.object({ start: z.string(), end: z.string() }),
        ]).optional().describe('Date range. Default: last_3_months'),
        minImpressions: z.number().int().min(1).optional().default(20).describe('Minimum impressions for a query to count'),
        minPosition: z.number().min(1).optional().default(4).describe('Best position to include — 4 skips queries already in the top 3'),
        maxPosition: z.number().min(1).optional().default(20).describe('Worst position to include'),
        limit: z.number().int().min(1).max(100).optional().default(30),
      })),
      execute: async (input: any) => {
        try {
          const { startDate, endDate } = resolveDateRange(input.dateRange ?? 'last_3_months');
          const result = await gscService.query(siteId, {
            startDate, endDate,
            dimensions: ['query', 'page'],
            rowLimit: 1000,
            searchType: 'web',
          });
          const rows = result.rows ?? [];
          const minImpr = input.minImpressions ?? 20;
          const minPos = input.minPosition ?? 4;
          const maxPos = input.maxPosition ?? 20;
          const opportunities = rows
            .map((r) => ({
              query: r.keys?.[0],
              page: r.keys?.[1],
              clicks: r.clicks,
              impressions: r.impressions,
              ctr: +(r.ctr * 100).toFixed(2),
              position: +r.position.toFixed(1),
              // opportunity score: impressions weighted toward positions near page 1
              score: Math.round(r.impressions / r.position),
            }))
            .filter((r) => r.position >= minPos && r.position <= maxPos && r.impressions >= minImpr)
            .sort((a, b) => b.score - a.score)
            .slice(0, input.limit ?? 30);
          return {
            dateRange: { startDate, endDate },
            _cached: result._cached ?? false,
            count: opportunities.length,
            note: opportunities.length === 0
              ? 'No striking-distance keywords found with the current thresholds. Try lowering minImpressions or widening the position range.'
              : 'Sorted by opportunity score (impressions ÷ position). Higher = bigger quick win. The page column is the URL already ranking for that query.',
            opportunities,
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),

    findKeywordCannibalization: tool({
      description:
        'Detects keyword cannibalization using Google Search Console: finds queries where 2+ pages of THIS site receive impressions, meaning multiple URLs compete for the same keyword and split ranking signals. ' +
        'Use for: "cannibalization", "which pages compete", "overlapping pages", "duplicate targeting", "pages fighting each other".',
      inputSchema: zodSchema(z.object({
        dateRange: z.union([
          z.enum(['last_7_days', 'last_28_days', 'last_3_months', 'this_month', 'last_month', 'last_quarter', 'last_year']),
          z.object({ start: z.string(), end: z.string() }),
        ]).optional().describe('Date range. Default: last_3_months'),
        minImpressions: z.number().int().min(1).optional().default(10).describe('Minimum impressions a page must have for that query to count as competing'),
        limit: z.number().int().min(1).max(50).optional().default(25),
      })),
      execute: async (input: any) => {
        try {
          const { startDate, endDate } = resolveDateRange(input.dateRange ?? 'last_3_months');
          const result = await gscService.query(siteId, {
            startDate, endDate,
            dimensions: ['query', 'page'],
            rowLimit: 1000,
            searchType: 'web',
          });
          const conflicts = detectCannibalization(result.rows ?? [], {
            minImpressions: input.minImpressions ?? 10,
            limit: input.limit ?? 25,
          });
          return {
            dateRange: { startDate, endDate },
            _cached: result._cached ?? false,
            count: conflicts.length,
            note: conflicts.length === 0
              ? 'No cannibalization detected — no query has 2+ competing pages above the impression threshold.'
              : 'Each entry shows a query and the pages competing for it (best position first). Recommend consolidating or differentiating the competing pages.',
            conflicts,
          };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),

    analyzeInternalLinks: tool({
      description:
        'Builds the internal link graph from page HTML to surface orphan pages (zero incoming internal links), authority hubs (most-linked pages), and pages with thin outgoing linking. ' +
        'Pass targetUrl to get the exact incoming + outgoing internal links for ONE page — use this in the optimize workflow to ground internalLinks suggestions and detect if the page is an orphan. ' +
        'Use for: "orphan pages", "internal linking", "which pages have no links pointing to them", "link structure", "where should I add internal links".',
      inputSchema: zodSchema(z.object({
        targetUrl: z.string().optional().describe('If set, return incoming + outgoing internal links for just this page'),
        limit: z.number().int().min(1).max(100).optional().default(25),
      })),
      execute: async (input: { targetUrl?: string; limit?: number }) => {
        const limit = input.limit ?? 25;
        const pages = await pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .select(['p.id', 'p.url'])
          .getMany();
        if (pages.length === 0) return { error: 'No pages for this site.' };

        const norm = (u: string): string | null => {
          try {
            const x = new URL(u);
            let p = x.pathname.replace(/\/+$/, '');
            if (!p) p = '/';
            return x.host.toLowerCase() + p.toLowerCase();
          } catch {
            return null;
          }
        };

        let host = '';
        try { host = new URL(pages[0].url).host.toLowerCase(); } catch { /* ignore */ }

        const byNorm = new Map<string, { id: string; url: string }>();
        const idToUrl = new Map<string, string>();
        for (const p of pages) {
          const n = norm(p.url);
          if (n) byNorm.set(n, { id: p.id, url: p.url });
          idToUrl.set(p.id, p.url);
        }

        // Extract links in Postgres (rawHtml is huge — never ship it to Node)
        const rows: { source_id: string; href: string }[] = await pageRepo.query(
          `SELECT DISTINCT p.id AS source_id, m[1] AS href
           FROM pages p,
           LATERAL regexp_matches(p."rawHtml", '<a\\s[^>]*href="([^"#?]+)', 'gi') AS m
           WHERE p."siteId" = $1 AND p."rawHtml" IS NOT NULL`,
          [siteId],
        );

        const incoming = new Map<string, Set<string>>();
        const outgoing = new Map<string, Set<string>>();
        for (const { source_id, href } of rows) {
          const sourceUrl = idToUrl.get(source_id);
          if (!sourceUrl) continue;
          let abs: string;
          try { abs = new URL(href, sourceUrl).toString(); } catch { continue; }
          const n = norm(abs);
          if (!n) continue;
          const target = byNorm.get(n);
          if (!target || target.id === source_id) continue;
          if (!incoming.has(target.id)) incoming.set(target.id, new Set());
          incoming.get(target.id)!.add(source_id);
          if (!outgoing.has(source_id)) outgoing.set(source_id, new Set());
          outgoing.get(source_id)!.add(target.id);
        }

        // Single-page detail
        if (input.targetUrl) {
          const tn = norm(input.targetUrl);
          const tgt = tn ? byNorm.get(tn) : null;
          if (!tgt) return { error: `No page found with URL: ${input.targetUrl}` };
          const inc = [...(incoming.get(tgt.id) ?? [])].map((id) => idToUrl.get(id)).filter(Boolean);
          const out = [...(outgoing.get(tgt.id) ?? [])].map((id) => idToUrl.get(id)).filter(Boolean);
          return {
            page: tgt.url,
            isOrphan: inc.length === 0,
            incomingCount: inc.length,
            outgoingCount: out.length,
            incomingLinks: inc.slice(0, 50),
            outgoingLinks: out.slice(0, 50),
            note: inc.length === 0
              ? 'This page is an ORPHAN — no other page links to it. Add internal links from relevant pages.'
              : undefined,
          };
        }

        // Site-wide summary
        const homeNorm = host ? `${host}/` : null;
        const orphans = pages.filter((p) => {
          const n = norm(p.url);
          if (!n || n === homeNorm) return false;
          return !(incoming.get(p.id)?.size);
        });
        const topLinked = pages
          .map((p) => ({ url: p.url, incoming: incoming.get(p.id)?.size ?? 0 }))
          .sort((a, b) => b.incoming - a.incoming)
          .slice(0, limit);
        const thinOutgoing = pages
          .map((p) => ({ url: p.url, outgoing: outgoing.get(p.id)?.size ?? 0 }))
          .filter((p) => p.outgoing < 3)
          .sort((a, b) => a.outgoing - b.outgoing)
          .slice(0, limit);

        return {
          totalPages: pages.length,
          orphanCount: orphans.length,
          orphanPages: orphans.slice(0, limit).map((p) => p.url),
          topLinkedPages: topLinked,
          thinOutgoingPages: thinOutgoing,
          note: 'Orphan = zero incoming internal links (homepage excluded). The graph includes nav/footer links, so authority hubs are usually nav targets. Pass targetUrl for one page\'s exact links.',
        };
      },
    }),

    searchPagesByKeyword: tool({
      description:
        'Exact text search across all page content, titles, and descriptions. ' +
        'Use this for: finding pages that mention a specific name, word, phrase, URL fragment, or brand. ' +
        'Use this when the user wants to know WHERE a specific term appears. ' +
        'NOT for topic/concept searches — use searchPagesByContent for those.',
      inputSchema: zodSchema(
        z.object({
          keyword: z.string().describe('The exact word or phrase to search for (case-insensitive)'),
          limit: z.number().int().min(1).max(50).optional().default(20),
        }),
      ),
      execute: async (input: { keyword: string; limit: number }) => {
        const term = `%${input.keyword.replace(/[%_\\]/g, '\\$&')}%`;
        const rows = await pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .andWhere(
            '(p.url ILIKE :term OR p."cleanContent" ILIKE :term OR p."metaTitle" ILIKE :term OR p."customMetaTitle" ILIKE :term OR p."metaDescription" ILIKE :term OR p."customMetaDescription" ILIKE :term)',
            { term },
          )
          .select(['p.id', 'p.url', 'p.metaTitle', 'p.customMetaTitle', 'p.metaDescription', 'p.customMetaDescription', 'p.isTransactional', 'p.noindex', 'p.cleanContent'])
          .limit(input.limit)
          .getMany();

        if (rows.length === 0) return { results: [], note: `No pages found containing "${input.keyword}"` };

        return {
          results: rows.map((p) => ({
            id: p.id,
            url: p.url,
            metaTitle: p.metaTitle,
            customMetaTitle: p.customMetaTitle,
            metaDescription: p.metaDescription,
            customMetaDescription: p.customMetaDescription,
            isTransactional: p.isTransactional,
            noindex: p.noindex,
            snippet: p.cleanContent
              ? (() => {
                  const idx = p.cleanContent!.toLowerCase().indexOf(input.keyword.toLowerCase());
                  if (idx === -1) return p.cleanContent!.slice(0, 200);
                  const start = Math.max(0, idx - 100);
                  const end = Math.min(p.cleanContent!.length, idx + 200);
                  return (start > 0 ? '…' : '') + p.cleanContent!.slice(start, end) + (end < p.cleanContent!.length ? '…' : '');
                })()
              : null,
          })),
        };
      },
    }),

    getSiteStructure: tool({
      description:
        'Returns all URL sections/patterns found on the site with page counts. ' +
        'Use this FIRST when the user asks about site sections, categories, types of pages, or what content exists on the site. ' +
        'Tells you which URL patterns (like /blog/, /author/, /services/) exist and how many pages each has.',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const pages = await pageRepo
          .createQueryBuilder('p')
          .where('p.siteId = :siteId', { siteId })
          .select('p.url')
          .getMany();

        const sections = new Map<string, number>();
        let homepageCount = 0;

        for (const page of pages) {
          try {
            const path = new URL(page.url).pathname;
            const parts = path.split('/').filter(Boolean);
            if (parts.length === 0) {
              homepageCount++;
            } else {
              const section = `/${parts[0]}/`;
              sections.set(section, (sections.get(section) || 0) + 1);
            }
          } catch { /* skip invalid URLs */ }
        }

        const sortedSections = Object.fromEntries(
          [...sections.entries()].sort((a, b) => b[1] - a[1]),
        );

        return {
          totalPages: pages.length,
          sections: { '/': homepageCount, ...sortedSections },
          note: 'Use urlContains with getPages to fetch pages from a specific section, e.g. urlContains: "/blog/"',
        };
      },
    }),

    // ── PageSpeed tools ──────────────────────────────────────────────────────

    getPageSpeedSummary: tool({
      description:
        'Returns PageSpeed Insights summary for this site: average score, and count of pages in Good (≥90), ' +
        'Needs Improvement (50-89), and Poor (<50) categories. Use when asked about overall site performance.',
      inputSchema: zodSchema(z.object({
        strategy: z.enum(['mobile', 'desktop']).optional().default('mobile')
          .describe('Device strategy. Default: mobile'),
      })),
      execute: async (input: { strategy: 'mobile' | 'desktop' }) => {
        const latest: any[] = await psiRepo.query(
          `SELECT DISTINCT ON ("pageId")
             "pageId", "performanceScore", category, "fetchedAt"
           FROM page_speed_results
           WHERE "siteId" = $1 AND strategy = $2
           ORDER BY "pageId", "fetchedAt" DESC`,
          [siteId, input.strategy],
        );
        if (latest.length === 0) return { error: 'No PageSpeed data yet. Ask the user to run a scan from the PageSpeed tab.' };
        const good = latest.filter((r) => r.category === 'good').length;
        const ni   = latest.filter((r) => r.category === 'needs_improvement').length;
        const poor = latest.filter((r) => r.category === 'poor').length;
        const avg  = Math.round(latest.reduce((s, r) => s + parseInt(r.performanceScore), 0) / latest.length);
        const lastScan = latest.reduce((max: Date | null, r: any) => {
          const d = new Date(r.fetchedAt);
          return !max || d > max ? d : max;
        }, null);
        return { strategy: input.strategy, avgScore: avg, good, needsImprovement: ni, poor, totalScanned: latest.length, lastScanAt: lastScan };
      },
    }),

    getPoorAndNiPages: tool({
      description:
        'Returns list of pages with Poor (<50) or Needs Improvement (50-89) PageSpeed scores, ' +
        'sorted by score ascending. Includes LCP, CLS, FCP, TBT metrics. ' +
        'Use when asked which pages need performance work or have bad scores.',
      inputSchema: zodSchema(z.object({
        strategy: z.enum(['mobile', 'desktop']).optional().default('mobile'),
        category: z.enum(['poor', 'needs_improvement', 'all']).optional().default('all')
          .describe('"poor" = score <50, "needs_improvement" = 50-89, "all" = both'),
        limit: z.number().int().min(1).max(50).optional().default(20),
      })),
      execute: async (input: { strategy: 'mobile' | 'desktop'; category: string; limit: number }) => {
        const categoryFilter = input.category === 'all'
          ? `AND category IN ('poor', 'needs_improvement')`
          : `AND category = '${input.category}'`;
        const rows: any[] = await psiRepo.query(
          `SELECT DISTINCT ON (r."pageId")
             r."pageId", p.url, r."performanceScore", r.category,
             r.lcp, r.cls, r.fcp, r.tbt, r."fetchedAt"
           FROM page_speed_results r
           JOIN pages p ON p.id = r."pageId"
           WHERE r."siteId" = $1 AND r.strategy = $2 ${categoryFilter}
           ORDER BY r."pageId", r."fetchedAt" DESC`,
          [siteId, input.strategy],
        );
        if (rows.length === 0) return { pages: [], note: `No pages with ${input.category === 'all' ? 'Poor or Needs Improvement' : input.category} status found.` };
        const sorted = rows.sort((a, b) => parseInt(a.performanceScore) - parseInt(b.performanceScore));
        return {
          total: sorted.length,
          strategy: input.strategy,
          pages: sorted.slice(0, input.limit).map((r) => ({
            url: r.url,
            score: parseInt(r.performanceScore),
            category: r.category,
            lcp: r.lcp ? `${(r.lcp / 1000).toFixed(1)}s` : null,
            fcp: r.fcp ? `${(r.fcp / 1000).toFixed(1)}s` : null,
            cls: r.cls != null ? parseFloat(r.cls).toFixed(3) : null,
            tbt: r.tbt ? `${r.tbt}ms` : null,
          })),
        };
      },
    }),

    analyzePageSpeed: tool({
      description:
        'Runs a live PageSpeed Insights analysis for a specific URL and returns the top failing audits ' +
        'with concrete improvement opportunities (what to fix and estimated savings). ' +
        'Use when the user asks to analyze a specific page, OR when analyzePoorPages has >10 pages and the user picks one.',
      inputSchema: zodSchema(z.object({
        url: z.string().describe('Full URL of the page to analyze'),
        strategy: z.enum(['mobile', 'desktop']).optional().default('mobile'),
      })),
      execute: async (input: { url: string; strategy: 'mobile' | 'desktop' }) => {
        return fetchPsiAudit(input.url, input.strategy, settingsService);
      },
    }),

    analyzePoorPages: tool({
      description:
        'Gets all Poor/Needs Improvement pages and their PageSpeed audits. ' +
        'If ≤10 pages: automatically fetches live PSI audits for all of them and returns full analysis. ' +
        'If >10 pages: returns the list only — the user should pick specific pages for analyzePageSpeed. ' +
        'Use when asked to analyze, improve, or diagnose performance across the site.',
      inputSchema: zodSchema(z.object({
        strategy: z.enum(['mobile', 'desktop']).optional().default('mobile'),
      })),
      execute: async (input: { strategy: 'mobile' | 'desktop' }) => {
        const rows: any[] = await psiRepo.query(
          `SELECT DISTINCT ON (r."pageId")
             r."pageId", p.url, r."performanceScore", r.category,
             r.lcp, r.cls, r.fcp, r.tbt
           FROM page_speed_results r
           JOIN pages p ON p.id = r."pageId"
           WHERE r."siteId" = $1 AND r.strategy = $2
             AND r.category IN ('poor', 'needs_improvement')
           ORDER BY r."pageId", r."fetchedAt" DESC`,
          [siteId, input.strategy],
        );

        if (rows.length === 0) {
          return { message: 'All pages are in Good status. No performance issues found.' };
        }

        const sorted = rows.sort((a, b) => parseInt(a.performanceScore) - parseInt(b.performanceScore));

        if (sorted.length > 10) {
          return {
            total: sorted.length,
            note: 'More than 10 pages need attention. Listing all — use analyzePageSpeed for specific URLs.',
            pages: sorted.map((r) => ({
              url: r.url,
              score: parseInt(r.performanceScore),
              category: r.category,
              lcp: r.lcp ? `${(r.lcp / 1000).toFixed(1)}s` : null,
              cls: r.cls != null ? parseFloat(r.cls).toFixed(3) : null,
              tbt: r.tbt ? `${r.tbt}ms` : null,
            })),
          };
        }

        // ≤10 pages — auto-analyze all
        const analyses: any[] = [];
        for (const row of sorted) {
          const audit = await fetchPsiAudit(row.url, input.strategy, settingsService);
          analyses.push(audit);
          // small delay between requests
          await new Promise((res) => setTimeout(res, 300));
        }

        return {
          total: sorted.length,
          strategy: input.strategy,
          note: 'Full audit results for all underperforming pages. Provide specific recommendations per page.',
          analyses,
        };
      },
    }),

    getFullPageAnalysis: tool({
      description:
        'Comprehensive single-call SEO context for a page: full content, GSC performance (last 3 months + 3m vs 3m comparison filtered to this URL), PageSpeed scores from DB, and the site brief. ' +
        'Use this as the FIRST and ONLY data-gathering step in any page optimization workflow — do not make separate GSC/PSI calls afterwards.',
      inputSchema: zodSchema(z.object({
        url: z.string().describe('Full URL of the page to analyze'),
      })),
      execute: async (input: { url: string }) => {
        // Normalize URL
        let cleanUrl = input.url;
        try { const u = new URL(input.url); u.search = ''; u.hash = ''; cleanUrl = u.toString(); } catch { /* keep */ }

        let page = await pageRepo.findOne({ where: { url: cleanUrl, siteId } });
        if (!page) {
          const alt = cleanUrl.endsWith('/') ? cleanUrl.slice(0, -1) : cleanUrl + '/';
          page = await pageRepo.findOne({ where: { url: alt, siteId } });
        }
        if (!page) return { error: `No page found with URL: ${input.url}` };

        // Date ranges
        const now = new Date();
        const cur3mEnd   = new Date(now.getTime() -   3 * 86400_000);
        const cur3mStart = new Date(now.getTime() -  93 * 86400_000);
        const prv3mEnd   = new Date(now.getTime() -  94 * 86400_000);
        const prv3mStart = new Date(now.getTime() - 183 * 86400_000);

        const pageFilter = [{ dimension: 'page' as const, operator: 'equals' as const, expression: page.url }];

        const [gscCur, gscPrv, psiRows, brief] = await Promise.allSettled([
          gscService.query(siteId, {
            startDate: fmtDate(cur3mStart), endDate: fmtDate(cur3mEnd),
            dimensions: ['query'], rowLimit: 50, filters: pageFilter, searchType: 'web',
          }),
          gscService.query(siteId, {
            startDate: fmtDate(prv3mStart), endDate: fmtDate(prv3mEnd),
            dimensions: ['query'], rowLimit: 50, filters: pageFilter, searchType: 'web',
          }),
          psiRepo.query(
            `SELECT DISTINCT ON (strategy) strategy, "performanceScore", lcp, cls, fcp, tbt
             FROM page_speed_results WHERE "pageId" = $1 ORDER BY strategy, "fetchedAt" DESC`,
            [page.id],
          ),
          briefRepo.findOne({ where: { siteId } }),
        ]);

        const mapRow = (r: any) => ({
          query: r.keys?.[0],
          clicks: r.clicks,
          impressions: r.impressions,
          ctr: +(r.ctr * 100).toFixed(2),
          position: +r.position.toFixed(1),
        });

        const curRows = gscCur.status === 'fulfilled' ? (gscCur.value.rows ?? []) : [];
        const prvRows = gscPrv.status === 'fulfilled' ? (gscPrv.value.rows ?? []) : [];
        const psiData  = psiRows.status === 'fulfilled' ? (psiRows.value as any[]) : [];
        const briefVal = brief.status === 'fulfilled' ? brief.value : null;

        const quickWins = curRows
          .map(mapRow)
          .filter(r => r.position >= 4 && r.position <= 15 && r.impressions > 5)
          .sort((a, b) => b.impressions - a.impressions)
          .slice(0, 10);

        return {
          page: {
            id: page.id,
            url: page.url,
            metaTitle: page.customMetaTitle ?? page.metaTitle,
            metaDescription: page.customMetaDescription ?? page.metaDescription,
            h1: page.h1Text,
            cleanContent: page.cleanContent,
            noindex: page.noindex,
            isTransactional: page.isTransactional,
          },
          gsc: {
            currentPeriod: {
              dateRange: { start: fmtDate(cur3mStart), end: fmtDate(cur3mEnd) },
              totalClicks: curRows.reduce((s: number, r: any) => s + r.clicks, 0),
              totalImpressions: curRows.reduce((s: number, r: any) => s + r.impressions, 0),
              topQueries: curRows.slice(0, 25).map(mapRow),
            },
            previousPeriod: {
              dateRange: { start: fmtDate(prv3mStart), end: fmtDate(prv3mEnd) },
              totalClicks: prvRows.reduce((s: number, r: any) => s + r.clicks, 0),
              totalImpressions: prvRows.reduce((s: number, r: any) => s + r.impressions, 0),
              topQueries: prvRows.slice(0, 10).map(mapRow),
            },
            quickWins,
            note: gscCur.status === 'rejected' ? 'GSC unavailable: ' + (gscCur.reason as Error)?.message : undefined,
          },
          pageSpeed: psiData.length > 0
            ? Object.fromEntries(psiData.map((r: any) => [r.strategy, {
                score: parseInt(r.performanceScore),
                lcp: r.lcp ? `${(r.lcp / 1000).toFixed(1)}s` : null,
                cls: r.cls != null ? parseFloat(r.cls).toFixed(3) : null,
                fcp: r.fcp ? `${(r.fcp / 1000).toFixed(1)}s` : null,
              }]))
            : null,
          brief: briefVal ? {
            keywordCsv: briefVal.keywordCsv,
            clientNotes: briefVal.clientNotes,
            locations: briefVal.locations,
            approvedCtas: briefVal.approvedCtas,
            spellingVariant: briefVal.spellingVariant,
            complianceNotes: briefVal.complianceNotes,
            pastPageExample: briefVal.pastPageExample,
          } : null,
        };
      },
    }),

    getSiteBrief: tool({
      description:
        'Returns the site brief: SEMrush keyword CSV, client notes, target locations, approved CTAs, compliance notes, past page example, and spelling variant. ' +
        'Use this as the first step in the new page creation workflow.',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const b = await briefRepo.findOne({ where: { siteId } });
        if (!b) return { error: 'No site brief configured. Ask the user to fill in the Site Brief section in site settings.' };
        return {
          keywordCsv: b.keywordCsv,
          clientNotes: b.clientNotes,
          locations: b.locations,
          approvedCtas: b.approvedCtas,
          spellingVariant: b.spellingVariant,
          complianceNotes: b.complianceNotes,
          pastPageExample: b.pastPageExample,
        };
      },
    }),

    getOfferingCatalog: tool({
      description:
        'Returns the authoritative Brand Card for this site: the EXACT catalog of real services/sub-services, ' +
        'locations, named people, approved claims/CTAs, and the "never mention" list. ' +
        'Call this BEFORE writing or rewriting any page so you only reference offerings that actually exist. ' +
        'The services list is exhaustive — do NOT introduce any offering absent from it.',
      inputSchema: zodSchema(z.object({})),
      execute: async () => {
        const c = await brandCardRepo.findOne({ where: { siteId } });
        if (!c) {
          return {
            error:
              'No Brand Card yet. Ask the user to derive/confirm it (Site settings → Brand Card), ' +
              'or ground page copy strictly in the source page content and other retrieved pages.',
          };
        }
        return {
          reviewed: c.reviewed,
          brandName: c.brandName,
          spelling: c.spelling,
          services: c.services,
          locations: c.locations,
          people: c.people,
          certifications: c.certifications,
          approvedClaims: c.approvedClaims,
          ctas: c.ctas,
          neverSay: c.neverSay,
          note: c.reviewed
            ? 'Human-verified. Treat services as the exhaustive offering allow-list.'
            : 'Auto-derived draft (not yet verified). Still treat services as the offering allow-list.',
        };
      },
    }),

    getSemrushKeywords: tool({
      description:
        'Returns SEMrush keyword data (volume, KD, intent, CPC, etc.) from the site brief CSV. ' +
        'These are MEASUREMENTS — quote volume/KD/intent EXACTLY as returned, never estimate them. ' +
        'Use when the user asks about keyword volume, difficulty, or search intent for planning.',
      inputSchema: zodSchema(z.object({
        contains: z.string().optional().describe('Optional substring to filter keywords by'),
        limit: z.number().int().min(1).max(200).optional().default(50),
      })),
      execute: async (input: { contains?: string; limit: number }) => {
        const b = await briefRepo.findOne({ where: { siteId } });
        if (!b?.keywordCsv || !b.keywordCsv.trim()) {
          return { error: 'No SEMrush keyword CSV in the site brief. Ask the user to paste it into the Site Brief.' };
        }
        const lines = b.keywordCsv.split(/\r?\n/).filter((l) => l.trim());
        if (lines.length < 2) return { error: 'Keyword CSV has no data rows.' };
        const delimiter = (lines[0].match(/;/g)?.length ?? 0) > (lines[0].match(/,/g)?.length ?? 0) ? ';' : ',';
        const parseRow = (l: string) => l.split(delimiter).map((c) => c.trim().replace(/^"|"$/g, ''));
        const headers = parseRow(lines[0]);
        let rows = lines.slice(1).map((l) => {
          const cells = parseRow(l);
          const obj: Record<string, string> = {};
          headers.forEach((h, i) => { obj[h] = cells[i] ?? ''; });
          return obj;
        });
        const keyCol = headers.find((h) => /keyword/i.test(h)) ?? headers[0];
        if (input.contains) {
          const needle = input.contains.toLowerCase();
          rows = rows.filter((r) => (r[keyCol] ?? '').toLowerCase().includes(needle));
        }
        const sliced = rows.slice(0, input.limit);
        return evidenceFor(
          'semrush',
          { columns: headers, rows: sliced, totalMatched: rows.length },
          `${rows.length} SEMrush keyword rows (columns: ${headers.join(', ')})`,
          null,
        );
      },
    }),

    searchPagesByContent: tool({
      description:
        'Semantic search — finds pages related to a topic, concept, or subject using AI similarity. ' +
        'Use this for: "find pages about pricing", "which pages cover SEO services", "pages related to contact". ' +
        'Do NOT use for finding exact names, words, or phrases — use searchPagesByKeyword for those.',
      inputSchema: zodSchema(
        z.object({
          query: z.string().describe('Natural language search query, e.g. "pricing page", "contact form", "blog posts about SEO"'),
          limit: z.number().int().min(1).max(20).optional().default(8),
        }),
      ),
      execute: async (input: { query: string; limit: number }) => {
        try {
          const results = await embeddingService.searchSimilar(siteId, input.query, input.limit);
          if (results.length === 0) {
            return { results: [], note: 'No embedded pages found. Ask the user to generate embeddings first via the site page.' };
          }
          return { results };
        } catch (err) {
          return { error: (err as Error).message };
        }
      },
    }),
  };
}
