import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { Ga4Service } from '../../ga4/ga4.service';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

/**
 * GA4 tools for the in-app AI assistant — so it can answer "did organic
 * conversions/revenue move?" with real Analytics data, not just Search Console
 * clicks. All numbers are ORGANIC-channel by default. The property is found
 * automatically by the site's domain.
 */
export function createGa4Tools(ga4: Ga4Service, siteId: string) {
  const range = z.object({
    from: z.string().optional().describe('Start date YYYY-MM-DD (default 28 days ago).'),
    to: z.string().optional().describe('End date YYYY-MM-DD (default yesterday).'),
  });
  const dr = (a: { from?: string; to?: string }) => ({ from: a.from ?? daysAgo(28), to: a.to ?? daysAgo(1) });

  return {
    getGa4Status: tool({
      description:
        'Check whether Google Analytics 4 is connected for this site and which GA4 property matched its domain.',
      inputSchema: zodSchema(z.object({})),
      execute: async () => ga4.getSiteStatus(siteId),
    }),

    getGa4Summary: tool({
      description:
        'Organic (SEO) totals from GA4 for a date range: sessions, conversions (key events), revenue, users. Use to quantify business outcome, not just rankings/clicks.',
      inputSchema: zodSchema(range),
      execute: async (args) => {
        const { from, to } = dr(args);
        const s = await ga4.getSummary(siteId, from, to);
        return { from, to, channel: 'Organic Search', ...s };
      },
    }),

    getGa4Series: tool({
      description:
        'Daily organic GA4 series (date → sessions, conversions, revenue, users) for a date range. Use to see how conversions/revenue trended around a change.',
      inputSchema: zodSchema(range),
      execute: async (args) => {
        const { from, to } = dr(args);
        const points = await ga4.getSeries(siteId, from, to);
        return { from, to, channel: 'Organic Search', points };
      },
    }),

    getGa4Report: tool({
      description:
        'Run a custom GA4 report. Provide GA4 metric names (e.g. sessions, conversions, totalRevenue, engagementRate, averageSessionDuration) and optional dimension names (e.g. date, sessionDefaultChannelGroup, landingPagePlusQueryString, deviceCategory, country). Set organicOnly=false to include all channels.',
      inputSchema: zodSchema(
        z.object({
          metrics: z.array(z.string()).min(1).describe('GA4 metric names.'),
          dimensions: z.array(z.string()).optional().describe('GA4 dimension names.'),
          from: z.string().optional(),
          to: z.string().optional(),
          organicOnly: z.boolean().optional().describe('Default true — restrict to organic search sessions.'),
          limit: z.number().int().min(1).max(10000).optional(),
        }),
      ),
      execute: async (args) => {
        const { from, to } = dr(args);
        const res = (await ga4.runReportForSite(siteId, {
          startDate: from, endDate: to,
          metrics: args.metrics, dimensions: args.dimensions,
          organicOnly: args.organicOnly ?? true, limit: args.limit ?? 250,
        })) as { rows?: unknown[]; metricHeaders?: unknown[]; dimensionHeaders?: unknown[] };
        // Trim to keep the model payload lean.
        return {
          from, to,
          dimensionHeaders: res.dimensionHeaders,
          metricHeaders: res.metricHeaders,
          rowCount: res.rows?.length ?? 0,
          rows: (res.rows ?? []).slice(0, args.limit ?? 250),
        };
      },
    }),
  };
}
