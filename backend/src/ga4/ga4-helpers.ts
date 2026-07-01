/**
 * Pure GA4 helpers — no I/O, unit-tested. Domain→data-stream matching (the
 * "find the property by the site's domain" requirement), Data API request
 * building (organic-only filter), and response mapping.
 */

/** Bare host for a URL/domain: strip protocol, `www.`, path, port. */
export function hostFromUrl(input: string): string {
  let s = (input || '').trim().toLowerCase();
  s = s.replace(/^https?:\/\//, '').replace(/^www\./, '');
  s = s.replace(/[/:?#].*$/, '');
  return s;
}

/**
 * Does a GA4 web data-stream's default URI belong to the site's domain?
 * Exact host or a subdomain match (so a `www.`/apex/subdomain stream still binds).
 */
export function streamMatchesDomain(streamUri: string | undefined | null, siteDomain: string): boolean {
  if (!streamUri) return false;
  const stream = hostFromUrl(streamUri);
  const domain = hostFromUrl(siteDomain);
  if (!stream || !domain) return false;
  return stream === domain || stream.endsWith('.' + domain) || domain.endsWith('.' + stream);
}

export interface RunReportOpts {
  startDate: string;
  endDate: string;
  dimensions?: string[];
  metrics: string[];
  /** Restrict to organic-search sessions (the default for SEO impact). */
  organicOnly?: boolean;
  limit?: number;
}

/** Build the Analytics Data API `runReport` request body. */
export function buildRunReportBody(opts: RunReportOpts): Record<string, unknown> {
  const body: Record<string, unknown> = {
    dateRanges: [{ startDate: opts.startDate, endDate: opts.endDate }],
    dimensions: (opts.dimensions ?? []).map((name) => ({ name })),
    metrics: opts.metrics.map((name) => ({ name })),
    ...(opts.limit ? { limit: String(opts.limit) } : {}),
  };
  if (opts.organicOnly) {
    body.dimensionFilter = {
      filter: {
        fieldName: 'sessionDefaultChannelGroup',
        stringFilter: { matchType: 'EXACT', value: 'Organic Search' },
      },
    };
  }
  return body;
}

/** GA4 `date` dimension is `YYYYMMDD`; normalize to `YYYY-MM-DD`. */
export function ga4DateToIso(ymd: string): string {
  return ymd && ymd.length === 8 ? `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}` : ymd;
}

export interface Ga4DailyPoint {
  date: string;
  [metric: string]: number | string;
}

/**
 * Map a `runReport` response whose first dimension is `date` into sorted daily
 * points keyed by metric name (numbers). Ignores non-date dimensions beyond [0].
 */
export function mapDailyReport(res: unknown): Ga4DailyPoint[] {
  const r = res as {
    metricHeaders?: { name: string }[];
    rows?: { dimensionValues?: { value: string }[]; metricValues?: { value: string }[] }[];
  };
  const headers = (r?.metricHeaders ?? []).map((h) => h.name);
  const rows = r?.rows ?? [];
  return rows
    .map((row) => {
      const point: Ga4DailyPoint = { date: ga4DateToIso(row.dimensionValues?.[0]?.value ?? '') };
      headers.forEach((name, i) => {
        point[name] = Number(row.metricValues?.[i]?.value ?? 0);
      });
      return point;
    })
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** Sum the given metrics across daily points (totals for a range). */
export function sumMetrics(points: Ga4DailyPoint[], metrics: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of metrics) out[m] = 0;
  for (const p of points) for (const m of metrics) out[m] += Number(p[m] ?? 0);
  return out;
}
