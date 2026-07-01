/**
 * Thin axios client over the CMS REST API.
 *
 * Responsibilities:
 *  - Prefix every call with `<baseUrl>/api`.
 *  - Unwrap the global TransformInterceptor envelope (`{ data: <payload> }`)
 *    so callers receive the real payload. Note the pages-list endpoint is
 *    therefore DOUBLE-nested on the wire (`{ data: { data: [...], meta } }`)
 *    and unwraps to `{ data: Page[], meta }`.
 *  - Surface backend error messages (`{ statusCode, message, path }`) as a
 *    clean Error whose `.message` the MCP layer turns into an `isError` result.
 *  - Resolve a human-friendly pageUrl to a pageId.
 */
import axios, {
  AxiosError,
  AxiosInstance,
  AxiosRequestConfig,
} from 'axios';
import FormData from 'form-data';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { Config } from './config.js';

/** Error carrying the CMS's own message + HTTP status. */
export class CmsApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'CmsApiError';
    this.status = status;
  }
}

/** Minimal Page shape we rely on (the CMS returns more; rawHtml is stripped). */
export interface PageLite {
  id: string;
  url: string;
  metaTitle?: string | null;
  customMetaTitle?: string | null;
  metaDescription?: string | null;
  customMetaDescription?: string | null;
  h1Text?: string | null;
  indexDirective?: string | null;
  noindex?: boolean | null;
  nofollow?: boolean | null;
  canonical?: string | null;
  ogTitle?: string | null;
  ogDescription?: string | null;
  ogImage?: string | null;
  ogImageId?: number | null;
  isTransactional?: boolean | null;
  syncStatus?: string | null;
  syncError?: string | null;
  syncAppliedAt?: string | null;
  lastScrapedAt?: string | null;
}

export interface PagesPage {
  data: PageLite[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export class CmsClient {
  private http: AxiosInstance;
  readonly defaultSiteId?: string;

  constructor(config: Config) {
    this.defaultSiteId = config.defaultSiteId;
    const headers: Record<string, string> = {};
    if (config.apiKey) {
      headers.Authorization = `Bearer ${config.apiKey}`;
      headers['X-API-Key'] = config.apiKey;
    }
    this.http = axios.create({
      baseURL: `${config.baseUrl}/api`,
      timeout: 120_000,
      headers,
    });
  }

  /** Resolve siteId from an explicit value or the configured default. */
  resolveSiteId(siteId?: string): string {
    const id = siteId || this.defaultSiteId;
    if (!id) {
      throw new CmsApiError(
        'No siteId provided and CMS_DEFAULT_SITE_ID is not set. Pass siteId or set the env var.',
      );
    }
    return id;
  }

  /** Core request with envelope-unwrap + error mapping. */
  private async request<T = unknown>(cfg: AxiosRequestConfig): Promise<T> {
    try {
      const res = await this.http.request(cfg);
      // 204 / empty body
      if (res.status === 204 || res.data === '' || res.data == null) {
        return undefined as unknown as T;
      }
      // Unwrap the TransformInterceptor envelope { data: <payload> }.
      if (
        typeof res.data === 'object' &&
        res.data !== null &&
        'data' in res.data
      ) {
        return (res.data as { data: T }).data;
      }
      return res.data as T;
    } catch (err) {
      throw toCmsError(err);
    }
  }

  // ── Generic verbs ──────────────────────────────────────────────────────────
  get<T = unknown>(url: string, params?: Record<string, unknown>): Promise<T> {
    return this.request<T>({ method: 'GET', url, params });
  }
  post<T = unknown>(url: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'POST', url, data: body });
  }
  patch<T = unknown>(url: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PATCH', url, data: body });
  }
  put<T = unknown>(url: string, body?: unknown): Promise<T> {
    return this.request<T>({ method: 'PUT', url, data: body });
  }
  delete<T = unknown>(url: string): Promise<T> {
    return this.request<T>({ method: 'DELETE', url });
  }

  // ── Sites ──────────────────────────────────────────────────────────────────
  listSites(): Promise<any[]> {
    return this.get<any[]>('/sites');
  }
  getSite(siteId: string): Promise<any> {
    return this.get<any>(`/sites/${siteId}`);
  }

  // ── Pages / Meta ─────────────────────────────────────────────────────────────
  listPages(
    siteId: string,
    opts: { page?: number; limit?: number; search?: string; sort?: string } = {},
  ): Promise<PagesPage> {
    return this.get<PagesPage>(`/sites/${siteId}/pages`, {
      page: opts.page ?? 1,
      limit: opts.limit ?? 50,
      search: opts.search ?? '',
      sort: opts.sort ?? 'url_asc',
    });
  }
  getPage(siteId: string, pageId: string): Promise<PageLite> {
    return this.get<PageLite>(`/sites/${siteId}/pages/${pageId}`);
  }

  /**
   * Resolve a pageId. Accepts an explicit pageId (returned as-is) OR a pageUrl
   * matched against the site's pages (exact match preferred, else unique
   * substring). Throws a helpful CmsApiError on miss / ambiguity.
   */
  async resolvePageId(
    siteId: string,
    args: { pageId?: string; pageUrl?: string },
  ): Promise<string> {
    if (args.pageId) return args.pageId;
    if (!args.pageUrl) {
      throw new CmsApiError('Provide either pageId or pageUrl.');
    }
    const needle = args.pageUrl.trim();
    const found = await this.listPages(siteId, { limit: 500, search: needle });
    const pages = found.data || [];
    const exact = pages.find(
      (p) => p.url === needle || p.url.replace(/\/$/, '') === needle.replace(/\/$/, ''),
    );
    if (exact) return exact.id;
    if (pages.length === 1) return pages[0].id;
    if (pages.length === 0) {
      throw new CmsApiError(`No page found matching pageUrl "${needle}".`);
    }
    throw new CmsApiError(
      `pageUrl "${needle}" is ambiguous (${pages.length} matches: ${pages
        .slice(0, 5)
        .map((p) => p.url)
        .join(', ')}). Pass an exact url or a pageId.`,
    );
  }

  // ── Approval gate: stage a PENDING change proposal ──────────────────────────
  createChange(
    siteId: string,
    body: {
      module: 'meta' | 'schema' | 'alt' | 'asana';
      action: string;
      targetType: 'page' | 'image' | 'task';
      targetId: string;
      targetLabel?: string | null;
      payload: Record<string, unknown>;
    },
  ): Promise<{ id: string; summary: string; status: string; module: string }> {
    return this.post(`/sites/${siteId}/changes`, body);
  }

  // ── Image upload (multipart) ────────────────────────────────────────────────
  async uploadImage(
    siteId: string,
    filePath: string,
  ): Promise<{ id: number; url: string; width: number | null; height: number | null; mime: string }> {
    const buffer = await readFile(filePath);
    const form = new FormData();
    form.append('file', buffer, { filename: basename(filePath) });
    try {
      const res = await this.http.post(`/sites/${siteId}/images/upload`, form, {
        headers: form.getHeaders(),
        maxBodyLength: Infinity,
        maxContentLength: Infinity,
      });
      const payload =
        res.data && typeof res.data === 'object' && 'data' in res.data
          ? (res.data as any).data
          : res.data;
      return payload;
    } catch (err) {
      throw toCmsError(err);
    }
  }
}

/** Map any thrown error to a CmsApiError carrying the backend message. */
function toCmsError(err: unknown): CmsApiError {
  if (axios.isAxiosError(err)) {
    const ax = err as AxiosError<any>;
    const status = ax.response?.status;
    const body = ax.response?.data;
    let message: string | undefined;
    if (body && typeof body === 'object') {
      const m = (body as any).message;
      message = Array.isArray(m) ? m.join('; ') : m;
    }
    if (!message) {
      message =
        status != null
          ? `HTTP ${status} from CMS at ${ax.config?.url ?? ''}`
          : `Cannot reach CMS at ${ax.config?.baseURL ?? ''} (${ax.code ?? ax.message}). Is the backend running?`;
    }
    return new CmsApiError(message, status);
  }
  return new CmsApiError((err as Error)?.message || 'Unknown error');
}
