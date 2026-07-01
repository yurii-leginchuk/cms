import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { Site } from '../sites/site.entity';
import { getGoogleAccessToken, loadGoogleCreds } from '../common/google/google-auth';
import {
  hostFromUrl, streamMatchesDomain, buildRunReportBody, mapDailyReport, sumMetrics,
  type Ga4DailyPoint, type RunReportOpts,
} from './ga4-helpers';

const GA4_SCOPE = 'https://www.googleapis.com/auth/analytics.readonly';
const ADMIN_BASE = 'https://analyticsadmin.googleapis.com/v1beta';
const DATA_BASE = 'https://analyticsdata.googleapis.com/v1beta';

/** Organic sessions + the money metrics (legacy `conversions` = key events). */
const IMPACT_METRICS = ['sessions', 'conversions', 'totalRevenue', 'totalUsers'];

export interface Ga4Property {
  propertyId: string;
  property: string; // "properties/123"
  displayName: string;
  streamUri: string;
}

export interface Ga4SiteStatus {
  connected: boolean;
  propertyId?: string;
  displayName?: string;
  streamUri?: string;
  reason?: 'no_credentials' | 'property_not_found' | 'access_denied' | 'error';
}

export interface Ga4SeriesPoint {
  date: string;
  sessions: number;
  conversions: number;
  revenue: number;
  users: number;
}

@Injectable()
export class Ga4Service {
  private readonly logger = new Logger(Ga4Service.name);
  private propertyCache = new Map<string, { value: Ga4Property; expiresAt: number }>();
  private reportCache = new Map<string, { value: unknown; expiresAt: number }>();
  /** One Admin-API discovery walk per domain at a time — parallel page loads share it. */
  private inflightDiscovery = new Map<string, Promise<Ga4Property>>();

  constructor(@InjectRepository(Site) private readonly siteRepo: Repository<Site>) {}

  async getCredsStatus(): Promise<{ connected: boolean; email?: string }> {
    try {
      const creds = await loadGoogleCreds();
      return { connected: true, email: creds.client_email };
    } catch {
      return { connected: false };
    }
  }

  private async requireSite(siteId: string): Promise<Site> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    return site;
  }

  // ── Property discovery by DOMAIN (the key requirement) ──────────────────────

  /**
   * The GA4 property for a site. Persisted on the site row after the first
   * successful discovery, so the steady state never touches the Admin API —
   * the walk (accountSummaries + dataStreams per property) is quota-bound and
   * was the source of intermittent "GA4 missing" on the Impact page.
   */
  async resolveProperty(site: Site): Promise<Ga4Property> {
    if (site.ga4PropertyId) {
      return {
        propertyId: site.ga4PropertyId,
        property: `properties/${site.ga4PropertyId}`,
        displayName: site.ga4PropertyName ?? '',
        streamUri: site.ga4StreamUri ?? '',
      };
    }
    const found = await this.discoverProperty(site.url);
    await this.siteRepo.update(site.id, {
      ga4PropertyId: found.propertyId,
      ga4PropertyName: found.displayName,
      ga4StreamUri: found.streamUri,
    });
    return found;
  }

  /** Drop the persisted mapping (property deleted / access revoked) so the next status re-discovers. */
  private async forgetProperty(site: Site): Promise<void> {
    this.propertyCache.delete(hostFromUrl(site.url));
    await this.siteRepo.update(site.id, {
      ga4PropertyId: null,
      ga4PropertyName: null,
      ga4StreamUri: null,
    });
  }

  /**
   * Find the GA4 property whose web data-stream domain matches the site's domain.
   * Lists account summaries → each property's data streams → matches the stream's
   * default URI host to the site domain. Cached 10 min; concurrent callers for
   * the same domain share one walk.
   */
  async discoverProperty(siteUrl: string): Promise<Ga4Property> {
    const domain = hostFromUrl(siteUrl);
    const cached = this.propertyCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) return cached.value;

    const inflight = this.inflightDiscovery.get(domain);
    if (inflight) return inflight;
    const walk = this.walkAdminApi(domain).finally(() => this.inflightDiscovery.delete(domain));
    this.inflightDiscovery.set(domain, walk);
    return walk;
  }

  private async walkAdminApi(domain: string): Promise<Ga4Property> {
    const token = await getGoogleAccessToken(GA4_SCOPE);
    const auth = { headers: { Authorization: `Bearer ${token}` } };

    // 1) All properties visible to the service account.
    const summaries = await this.pagedGet(
      `${ADMIN_BASE}/accountSummaries?pageSize=200`,
      'accountSummaries',
      auth,
    );
    const properties: { property: string; displayName: string }[] = [];
    for (const acc of summaries) {
      for (const ps of (acc as any).propertySummaries ?? []) {
        properties.push({ property: ps.property, displayName: ps.displayName });
      }
    }

    // 2) Match a web stream's default URI to the domain (stop at first match).
    for (const p of properties) {
      const streams = await this.pagedGet(
        `${ADMIN_BASE}/${p.property}/dataStreams?pageSize=200`,
        'dataStreams',
        auth,
      );
      for (const s of streams) {
        const uri = (s as any).webStreamData?.defaultUri as string | undefined;
        if (streamMatchesDomain(uri, domain)) {
          const value: Ga4Property = {
            propertyId: p.property.replace('properties/', ''),
            property: p.property,
            displayName: p.displayName,
            streamUri: uri!,
          };
          this.propertyCache.set(domain, { value, expiresAt: Date.now() + 10 * 60 * 1000 });
          return value;
        }
      }
    }
    throw new NotFoundException(
      `No GA4 property found for "${domain}". Add the service account as a Viewer in that property's Access Management.`,
    );
  }

  async getSiteStatus(siteId: string): Promise<Ga4SiteStatus> {
    const site = await this.requireSite(siteId);
    try {
      await loadGoogleCreds();
    } catch {
      return { connected: false, reason: 'no_credentials' };
    }
    try {
      const p = await this.resolveProperty(site);
      return { connected: true, propertyId: p.propertyId, displayName: p.displayName, streamUri: p.streamUri };
    } catch (e) {
      const status = (e as AxiosError)?.response?.status;
      if (status === 403) return { connected: false, reason: 'access_denied' };
      if (e instanceof NotFoundException) return { connected: false, reason: 'property_not_found' };
      // Transient (quota/timeout/network) — NOT "not connected"; callers must not cache this as a setup state.
      return { connected: false, reason: 'error' };
    }
  }

  // ── Reports (Data API) ──────────────────────────────────────────────────────

  /** Raw runReport against a site's matched property (used by the agent tool). */
  async runReportForSite(siteId: string, opts: RunReportOpts): Promise<unknown> {
    const site = await this.requireSite(siteId);
    const prop = await this.resolveProperty(site);
    try {
      return await this.runReport(prop.property, buildRunReportBody(opts));
    } catch (err) {
      // Persisted property no longer reachable (deleted / access revoked):
      // forget it so the next status call re-discovers by domain.
      const httpStatus = (err as { httpStatus?: number }).httpStatus;
      if (site.ga4PropertyId && (httpStatus === 403 || httpStatus === 404)) {
        this.logger.warn(`GA4 property ${prop.propertyId} unreachable for site ${site.id} — clearing persisted mapping`);
        await this.forgetProperty(site);
      }
      throw err;
    }
  }

  private async runReport(property: string, body: Record<string, unknown>): Promise<unknown> {
    const key = `${property}:${JSON.stringify(body)}`;
    const cached = this.reportCache.get(key);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const token = await getGoogleAccessToken(GA4_SCOPE);
    try {
      const res = await this.withRetry(() =>
        axios.post(`${DATA_BASE}/${property}:runReport`, body, {
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          timeout: 30_000,
        }),
      );
      this.reportCache.set(key, { value: res.data, expiresAt: Date.now() + 30 * 60 * 1000 });
      return res.data;
    } catch (err) {
      const msg = err instanceof AxiosError ? JSON.stringify(err.response?.data ?? err.message) : (err as Error).message;
      this.logger.warn(`GA4 runReport failed for ${property}`);
      const wrapped = new Error(`GA4 report failed: ${msg}`) as Error & { httpStatus?: number };
      wrapped.httpStatus = err instanceof AxiosError ? err.response?.status : undefined;
      throw wrapped;
    }
  }

  /** Daily ORGANIC series: sessions / conversions / revenue / users. */
  async getSeries(siteId: string, from: string, to: string): Promise<Ga4SeriesPoint[]> {
    const raw = await this.runReportForSite(siteId, {
      startDate: from, endDate: to, dimensions: ['date'], metrics: IMPACT_METRICS, organicOnly: true, limit: 100000,
    });
    return (mapDailyReport(raw) as Ga4DailyPoint[]).map((p) => ({
      date: p.date,
      sessions: Number(p.sessions ?? 0),
      conversions: Number(p.conversions ?? 0),
      revenue: Number(p.totalRevenue ?? 0),
      users: Number(p.totalUsers ?? 0),
    }));
  }

  /** Range totals for the ORGANIC channel. */
  async getSummary(
    siteId: string, from: string, to: string,
  ): Promise<{ sessions: number; conversions: number; revenue: number; users: number }> {
    const pts = (await this.getSeries(siteId, from, to)).map((p) => ({
      date: p.date, sessions: p.sessions, conversions: p.conversions, totalRevenue: p.revenue, totalUsers: p.users,
    }));
    const t = sumMetrics(pts, ['sessions', 'conversions', 'totalRevenue', 'totalUsers']);
    return { sessions: t.sessions, conversions: t.conversions, revenue: t.totalRevenue, users: t.totalUsers };
  }

  // ── helpers ──────────────────────────────────────────────────────────────────

  private async pagedGet(url: string, field: string, auth: object, cap = 5): Promise<unknown[]> {
    const out: unknown[] = [];
    let next: string | undefined;
    for (let i = 0; i < cap; i++) {
      const u = next ? `${url}&pageToken=${encodeURIComponent(next)}` : url;
      const res = await this.withRetry(() => axios.get(u, { ...auth, timeout: 20_000 }));
      out.push(...((res.data?.[field] as unknown[]) ?? []));
      next = res.data?.nextPageToken;
      if (!next) break;
    }
    return out;
  }

  /** Retry transient failures (429 / 5xx / network) with a short backoff; 4xx setup errors surface immediately. */
  private async withRetry<T>(fn: () => Promise<T>, delaysMs: number[] = [500, 1500]): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return await fn();
      } catch (err) {
        const status = err instanceof AxiosError ? err.response?.status : undefined;
        const transient = status === 429 || (status !== undefined && status >= 500) || (err instanceof AxiosError && !err.response);
        if (!transient || attempt >= delaysMs.length) throw err;
        await new Promise((r) => setTimeout(r, delaysMs[attempt]));
      }
    }
  }
}
