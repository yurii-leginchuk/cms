import {
  Injectable,
  Logger,
  BadRequestException,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosError } from 'axios';
import * as crypto from 'crypto';
import * as fs from 'fs/promises';
import * as path from 'path';
import { GscCache } from './gsc-cache.entity';
import { Site } from '../sites/site.entity';

export interface GscQueryParams {
  startDate: string;
  endDate: string;
  dimensions?: ('query' | 'page' | 'country' | 'device' | 'date')[];
  rowLimit?: number;
  startRow?: number;
  searchType?: 'web' | 'image' | 'video' | 'news';
  filters?: Array<{
    dimension: string;
    operator: string;
    expression: string;
  }>;
  aggregationType?: 'auto' | 'byPage' | 'byProperty';
}

export interface GscRow {
  keys: string[];
  clicks: number;
  impressions: number;
  ctr: number;
  position: number;
}

export interface GscQueryResult {
  rows: GscRow[];
  responseAggregationType?: string;
  _cached?: boolean;
  _cachedAt?: Date;
}

interface ServiceAccountCreds {
  type: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const CREDS_PATH = process.env.GSC_CREDENTIALS_PATH
  || path.join(process.cwd(), 'gsc-credentials.json');

// ── Date helpers ──────────────────────────────────────────────────────────────

function fmt(d: Date): string { return d.toISOString().slice(0, 10); }
function daysAgo(n: number): string { return fmt(new Date(Date.now() - n * 86_400_000)); }

const DATE_PRESETS: Record<string, () => { startDate: string; endDate: string }> = {
  last_7_days:    () => ({ startDate: daysAgo(7),   endDate: daysAgo(1) }),
  last_28_days:   () => ({ startDate: daysAgo(28),  endDate: daysAgo(1) }),
  last_3_months:  () => ({ startDate: daysAgo(90),  endDate: daysAgo(1) }),
  last_year:      () => ({ startDate: daysAgo(365), endDate: daysAgo(1) }),
  this_month: () => {
    const n = new Date();
    return { startDate: fmt(new Date(n.getFullYear(), n.getMonth(), 1)), endDate: daysAgo(1) };
  },
  last_month: () => {
    const n = new Date();
    return {
      startDate: fmt(new Date(n.getFullYear(), n.getMonth() - 1, 1)),
      endDate:   fmt(new Date(n.getFullYear(), n.getMonth(), 0)),
    };
  },
  last_quarter: () => {
    const n = new Date();
    const q = Math.floor(n.getMonth() / 3);
    return {
      startDate: fmt(new Date(n.getFullYear(), (q - 1) * 3, 1)),
      endDate:   fmt(new Date(n.getFullYear(), q * 3, 0)),
    };
  },
};

export function resolveDateRange(
  range: string | { start: string; end: string },
): { startDate: string; endDate: string } {
  if (typeof range === 'object') return { startDate: range.start, endDate: range.end };
  return (DATE_PRESETS[range] ?? DATE_PRESETS['last_28_days'])();
}

// ── Service ───────────────────────────────────────────────────────────────────

@Injectable()
export class GscService {
  private readonly logger = new Logger(GscService.name);
  private tokenCache: { token: string; expiresAt: number } | null = null;

  constructor(
    @InjectRepository(GscCache)
    private readonly cacheRepo: Repository<GscCache>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
  ) {}

  // ── Status ─────────────────────────────────────────────────────────────────

  async getStatus(): Promise<{ connected: boolean; email?: string; path: string }> {
    try {
      const creds = await this.loadCreds();
      return { connected: true, email: creds.client_email, path: CREDS_PATH };
    } catch {
      return { connected: false, path: CREDS_PATH };
    }
  }

  // ── Properties ─────────────────────────────────────────────────────────────

  async listProperties(): Promise<string[]> {
    const token = await this.getToken();
    const res = await axios.get('https://www.googleapis.com/webmasters/v3/sites', {
      headers: { Authorization: `Bearer ${token}` },
    });
    return ((res.data.siteEntry as any[]) ?? []).map((s) => s.siteUrl as string);
  }

  // ── Per-site status ─────────────────────────────────────────────────────────

  async getSiteStatus(siteUrl: string): Promise<{ connected: boolean; property?: string; reason?: string }> {
    try {
      await this.loadCreds();
    } catch {
      return { connected: false, reason: 'no_credentials' };
    }
    try {
      await this.getToken();
    } catch {
      return { connected: false, reason: 'no_credentials' };
    }
    try {
      const property = await this.resolveProperty(siteUrl);
      return { connected: true, property };
    } catch {
      return { connected: false, reason: 'domain_not_found' };
    }
  }

  // ── Auto-resolve property from site URL ─────────────────────────────────────

  private propertyCache = new Map<string, { property: string; expiresAt: number }>();

  async resolveProperty(siteUrl: string): Promise<string> {
    const domain = this.extractDomain(siteUrl);

    const cached = this.propertyCache.get(domain);
    if (cached && cached.expiresAt > Date.now()) return cached.property;

    const properties = await this.listProperties();
    const match = properties.find((p) => this.propertyMatchesDomain(p, domain));

    if (!match) {
      throw new BadRequestException(
        `No GSC property found for "${domain}". ` +
        'Add the service account as Full User in Search Console.',
      );
    }

    this.propertyCache.set(domain, { property: match, expiresAt: Date.now() + 10 * 60 * 1000 });
    return match;
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url.replace(/^www\./, '');
    }
  }

  private propertyMatchesDomain(property: string, domain: string): boolean {
    if (property.startsWith('sc-domain:')) {
      const propDomain = property.replace('sc-domain:', '').replace(/^www\./, '');
      return domain === propDomain || domain.endsWith('.' + propDomain);
    }
    try {
      const propHost = new URL(property).hostname.replace(/^www\./, '');
      return propHost === domain;
    } catch {
      return false;
    }
  }

  // ── Query with cache ────────────────────────────────────────────────────────

  async query(siteId: string, params: GscQueryParams): Promise<GscQueryResult> {
    const cacheKey = this.buildCacheKey(siteId, params);

    const cached = await this.cacheRepo.findOne({ where: { cacheKey } });
    if (cached && cached.expiresAt > new Date()) {
      this.logger.debug(`GSC cache hit: ${cacheKey}`);
      return { ...(cached.data as any), _cached: true, _cachedAt: cached.createdAt };
    }

    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new BadRequestException('Site not found');

    const property = await this.resolveProperty(site.url);
    const token = await this.getToken();

    // Build the GSC request body explicitly. The Search Console API ignores a
    // top-level `filters` key — dimension filters MUST be wrapped in
    // `dimensionFilterGroups`, otherwise every filtered query silently returns
    // whole-site rows. Likewise the API expects `type`, not `searchType`.
    const requestBody = this.buildRequestBody(params);

    let data: GscQueryResult;
    try {
      const res = await axios.post(
        `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(property)}/searchAnalytics/query`,
        requestBody,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 30_000 },
      );
      data = res.data as GscQueryResult;
    } catch (err) {
      if (err instanceof AxiosError) {
        const msg = err.response?.data?.error?.message ?? err.message;
        const status = err.response?.status;
        if (status === 403) throw new UnauthorizedException(`GSC API: ${msg}`);
        throw new BadRequestException(`GSC API error (${status}): ${msg}`);
      }
      throw err;
    }

    const expiresAt = new Date(Date.now() + CACHE_TTL_MS);
    await this.cacheRepo.upsert(
      { cacheKey, siteId, queryParams: params as any, data: data as any, expiresAt },
      ['cacheKey'],
    );

    return data;
  }

  async clearCache(siteId?: string): Promise<void> {
    if (siteId) await this.cacheRepo.delete({ siteId });
    else await this.cacheRepo.clear();
  }

  // ── Private: Service Account JWT ───────────────────────────────────────────

  private async loadCreds(): Promise<ServiceAccountCreds> {
    let raw: string;
    try {
      raw = await fs.readFile(CREDS_PATH, 'utf8');
    } catch {
      throw new UnauthorizedException(`GSC credentials file not found at: ${CREDS_PATH}`);
    }
    let creds: ServiceAccountCreds;
    try {
      creds = JSON.parse(raw) as ServiceAccountCreds;
    } catch {
      throw new UnauthorizedException('GSC credentials file is not valid JSON');
    }
    if (!creds.client_email || !creds.private_key) {
      throw new UnauthorizedException(
        'GSC credentials file is missing client_email or private_key — place a valid service account JSON file',
      );
    }
    return creds;
  }

  private async getToken(): Promise<string> {
    if (this.tokenCache && this.tokenCache.expiresAt - Date.now() > 60_000) {
      return this.tokenCache.token;
    }

    const creds = await this.loadCreds();
    const now = Math.floor(Date.now() / 1000);

    const header  = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const payload = b64url(JSON.stringify({
      iss:   creds.client_email,
      scope: 'https://www.googleapis.com/auth/webmasters.readonly',
      aud:   creds.token_uri ?? 'https://oauth2.googleapis.com/token',
      exp:   now + 3600,
      iat:   now,
    }));

    const sign = crypto.createSign('RSA-SHA256');
    sign.update(`${header}.${payload}`);
    const signature = sign.sign(creds.private_key, 'base64url');
    const jwt = `${header}.${payload}.${signature}`;

    try {
      const res = await axios.post(
        creds.token_uri ?? 'https://oauth2.googleapis.com/token',
        new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
          assertion: jwt,
        }),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
      );
      const token: string = res.data.access_token;
      this.tokenCache = { token, expiresAt: Date.now() + 3_500_000 };
      this.logger.log('GSC service account token acquired');
      return token;
    } catch (err) {
      const msg = err instanceof AxiosError ? JSON.stringify(err.response?.data) : (err as Error).message;
      throw new UnauthorizedException(`GSC token exchange failed: ${msg}`);
    }
  }

  // Translate our GscQueryParams into the exact body the Search Console
  // `searchAnalytics/query` endpoint expects. Only emit keys that are set so we
  // don't send `dimensionFilterGroups: []` (the API treats an empty group as a
  // valid-but-no-op filter on some shapes — safest to omit entirely).
  buildRequestBody(params: GscQueryParams): Record<string, unknown> {
    const body: Record<string, unknown> = {
      startDate: params.startDate,
      endDate: params.endDate,
    };
    if (params.dimensions && params.dimensions.length > 0) body.dimensions = params.dimensions;
    if (params.rowLimit !== undefined) body.rowLimit = params.rowLimit;
    if (params.startRow !== undefined) body.startRow = params.startRow;
    if (params.aggregationType) body.aggregationType = params.aggregationType;
    // GSC's field is `type`, not `searchType`.
    if (params.searchType) body.type = params.searchType;
    if (params.filters && params.filters.length > 0) {
      body.dimensionFilterGroups = [{ groupType: 'and', filters: params.filters }];
    }
    return body;
  }

  private buildCacheKey(siteId: string, params: GscQueryParams): string {
    // CACHE_VERSION is bumped whenever the request-body shape changes so stale
    // rows from the pre-`dimensionFilterGroups` era are never served. (v1→v2:
    // dimension filters are now actually applied; old cached rows were unfiltered.)
    const CACHE_VERSION = 2;
    return crypto
      .createHash('md5')
      .update(JSON.stringify({ v: CACHE_VERSION, siteId, ...params }))
      .digest('hex');
  }
}

function b64url(str: string): string {
  return Buffer.from(str).toString('base64url');
}
