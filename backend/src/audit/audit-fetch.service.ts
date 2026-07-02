import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as https from 'https';
import * as tls from 'tls';
import { XMLParser } from 'fast-xml-parser';
import {
  HttpsSignal,
  LiveProbeSignal,
  NotFoundProbeSignal,
  RobotsSignal,
  SitemapSignal,
} from './audit-detectors/detector-types';
import { parseHeadSignal } from './audit-head';

const UA = 'CMS-Bot/1.0';
const FETCH_TIMEOUT_MS = 15000;
const THROTTLE_MS = 250;
const MAX_REDIRECT_HOPS = 5;
const MAX_BODY = 2 * 1024 * 1024; // 2 MB is plenty for a head parse
const ROBOTS_BODY_CAP = 100 * 1024;
const MAX_NESTED_SITEMAPS = 10;

/**
 * Hard per-run live-fetch budget (locked decision D2, default 50/site/run).
 * Every HTTP request the audit makes consumes one unit; when the budget is
 * exhausted the caller must degrade honestly (scopeComplete=false), never
 * silently skip.
 */
export class FetchBudget {
  used = 0;
  constructor(readonly limit: number) {}
  get remaining(): number {
    return Math.max(0, this.limit - this.used);
  }
  tryConsume(n = 1): boolean {
    if (this.used + n > this.limit) return false;
    this.used += n;
    return true;
  }
}

/**
 * The audit's bounded live-fetch layer. Plain `CMS-Bot/1.0` fetches only —
 * NEVER a Googlebot spoof (the planned Security module owns that axis).
 * Every method is best-effort and returns a verbatim signal object; transport
 * failures are data, not exceptions.
 */
@Injectable()
export class AuditFetchService {
  private readonly logger = new Logger(AuditFetchService.name);
  private readonly xml = new XMLParser({ ignoreAttributes: false });

  /** GET robots.txt (a 404 body is fine — the detector decides). */
  async fetchRobots(siteUrl: string, budget: FetchBudget): Promise<RobotsSignal> {
    const url = `${originOf(siteUrl)}/robots.txt`;
    const base: RobotsSignal = {
      url, fetchedAt: new Date().toISOString(), ok: false,
      error: null, timedOut: false, status: null, content: null,
    };
    if (!budget.tryConsume()) return { ...base, error: 'live_fetch_budget_exhausted' };
    try {
      const res = await axios.get(url, {
        timeout: FETCH_TIMEOUT_MS,
        headers: { 'User-Agent': UA },
        validateStatus: () => true,
        maxRedirects: 3,
        maxContentLength: MAX_BODY,
        responseType: 'text',
        transformResponse: [(d) => d],
      });
      const content = res.status >= 200 && res.status < 300 && typeof res.data === 'string'
        ? res.data.slice(0, ROBOTS_BODY_CAP)
        : null;
      await sleep(THROTTLE_MS);
      return { ...base, ok: true, status: res.status, content };
    } catch (err) {
      await sleep(THROTTLE_MS);
      return { ...base, error: (err as Error).message, timedOut: isTimeout(err) };
    }
  }

  /** Fetch + parse the sitemap (recursing into index files, budget-bounded). */
  async fetchSitemap(sitemapUrl: string, budget: FetchBudget): Promise<SitemapSignal> {
    const base: SitemapSignal = {
      url: sitemapUrl, fetchedAt: new Date().toISOString(), ok: false,
      error: null, transportError: false, status: null,
      urlCount: null, parseError: null, hosts: [], fetchesUsed: 0,
    };
    if (!budget.tryConsume()) return { ...base, error: 'live_fetch_budget_exhausted', transportError: true };
    base.fetchesUsed = 1;
    let res;
    try {
      res = await axios.get(sitemapUrl, {
        timeout: FETCH_TIMEOUT_MS,
        headers: { 'User-Agent': UA },
        validateStatus: () => true,
        responseType: 'text',
        transformResponse: [(d) => d],
      });
    } catch (err) {
      await sleep(THROTTLE_MS);
      return { ...base, error: (err as Error).message, transportError: true };
    }
    await sleep(THROTTLE_MS);
    base.ok = true;
    base.status = res.status;
    if (res.status >= 400) return base;

    const urls: string[] = [];
    try {
      const parsed = this.xml.parse(String(res.data ?? ''));
      if (parsed.sitemapindex) {
        const children = toArray(parsed.sitemapindex.sitemap)
          .map((s: any) => s?.loc)
          .filter(Boolean)
          .slice(0, MAX_NESTED_SITEMAPS);
        for (const loc of children) {
          if (!budget.tryConsume()) break;
          base.fetchesUsed += 1;
          try {
            const child = await axios.get(String(loc), {
              timeout: FETCH_TIMEOUT_MS,
              headers: { 'User-Agent': UA },
              validateStatus: () => true,
              responseType: 'text',
              transformResponse: [(d) => d],
            });
            if (child.status < 400) {
              const cp = this.xml.parse(String(child.data ?? ''));
              if (cp.urlset) {
                urls.push(...toArray(cp.urlset.url).map((u: any) => u?.loc).filter(Boolean));
              }
            }
          } catch {
            // child failure — the top-level file itself is fine; count what we got
          }
          await sleep(THROTTLE_MS);
        }
      } else if (parsed.urlset) {
        urls.push(...toArray(parsed.urlset.url).map((u: any) => u?.loc).filter(Boolean));
      } else {
        base.parseError = 'Neither <urlset> nor <sitemapindex> found';
        return base;
      }
    } catch (err) {
      base.parseError = (err as Error).message;
      return base;
    }
    base.urlCount = urls.length;
    const hosts = new Map<string, number>();
    for (const u of urls) {
      try {
        const h = new URL(String(u)).hostname.toLowerCase().replace(/^www\./, '');
        hosts.set(h, (hosts.get(h) ?? 0) + 1);
      } catch { /* unparseable loc — ignore for host stats */ }
    }
    base.hosts = [...hosts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([h]) => h);
    return base;
  }

  /** Homepage over HTTPS (with cert inspection) + plain HTTP redirect check. */
  async fetchHttpsSignal(siteUrl: string, budget: FetchBudget): Promise<HttpsSignal> {
    const host = hostOf(siteUrl);
    const out: HttpsSignal = {
      fetchedAt: new Date().toISOString(),
      https: { ok: false, status: null, error: null },
      cert: { authorized: null, validTo: null, daysRemaining: null, issuer: null, error: null },
      http: { ok: false, status: null, redirectsToHttps: null, location: null, error: null },
    };
    if (!host) {
      out.https.error = out.cert.error = out.http.error = 'unparseable site URL';
      return out;
    }

    if (budget.tryConsume()) {
      const r = await this.headWithCert(host);
      out.https = { ok: r.status != null, status: r.status, error: r.error };
      out.cert = r.cert;
      await sleep(THROTTLE_MS);
    } else {
      out.https.error = out.cert.error = 'live_fetch_budget_exhausted';
    }

    if (budget.tryConsume()) {
      try {
        const res = await axios.get(`http://${host}/`, {
          timeout: FETCH_TIMEOUT_MS,
          headers: { 'User-Agent': UA },
          validateStatus: () => true,
          maxRedirects: 0,
          maxContentLength: MAX_BODY,
        });
        const location = String(res.headers?.location ?? '') || null;
        out.http = {
          ok: true,
          status: res.status,
          location,
          redirectsToHttps:
            res.status >= 300 && res.status < 400 && location != null
              ? /^https:\/\//i.test(location)
              : false,
          error: null,
        };
      } catch (err) {
        out.http.error = (err as Error).message;
      }
      await sleep(THROTTLE_MS);
    } else {
      out.http.error = 'live_fetch_budget_exhausted';
    }
    return out;
  }

  /** GET a guaranteed-nonexistent URL — calibrates the site's 404 template. */
  async probe404(siteUrl: string, budget: FetchBudget): Promise<NotFoundProbeSignal> {
    const probeUrl = `${originOf(siteUrl)}/cms-audit-404-probe-${Date.now()}`;
    const base: NotFoundProbeSignal = {
      probeUrl, fetchedAt: new Date().toISOString(), ok: false,
      error: null, status: null, title: null, contentLength: null,
    };
    if (!budget.tryConsume()) return { ...base, error: 'live_fetch_budget_exhausted' };
    try {
      const res = await axios.get(probeUrl, {
        timeout: FETCH_TIMEOUT_MS,
        headers: { 'User-Agent': UA },
        validateStatus: () => true,
        maxRedirects: 3,
        maxContentLength: MAX_BODY,
        responseType: 'text',
        transformResponse: [(d) => d],
      });
      const body = typeof res.data === 'string' ? res.data : '';
      const head = parseHeadSignal(body);
      await sleep(THROTTLE_MS);
      return { ...base, ok: true, status: res.status, title: head?.title ?? null, contentLength: body.length };
    } catch (err) {
      await sleep(THROTTLE_MS);
      return { ...base, error: (err as Error).message };
    }
  }

  /**
   * Cache-busted live probe of one URL (model: schema-qc fetchLive): manual
   * redirect following (≤5 hops) so the exact chain is recorded, X-Robots-Tag
   * captured on the first hop, final body head-parsed. ONE budget unit per
   * subject regardless of hop count (documented budget semantics).
   */
  async probeUrl(url: string, budget: FetchBudget): Promise<LiveProbeSignal | null> {
    if (!budget.tryConsume()) return null;
    const signal: LiveProbeSignal = {
      url, fetchedAt: new Date().toISOString(), ok: false, error: null, timedOut: false,
      status: null, finalStatus: null, finalUrl: null, redirectChain: [],
      xRobotsTag: null, head: null, contentLength: null,
    };
    let current = withCacheBuster(url);
    try {
      for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop++) {
        const res = await axios.get(current, {
          timeout: FETCH_TIMEOUT_MS,
          headers: { 'User-Agent': UA, 'Cache-Control': 'no-cache', Pragma: 'no-cache' },
          validateStatus: () => true,
          maxRedirects: 0,
          maxContentLength: MAX_BODY,
          responseType: 'text',
          transformResponse: [(d) => d],
        });
        if (hop === 0) {
          signal.status = res.status;
          signal.xRobotsTag = String(res.headers?.['x-robots-tag'] ?? '') || null;
        }
        const location = String(res.headers?.location ?? '') || null;
        if (res.status >= 300 && res.status < 400 && location) {
          const resolved = new URL(location, current).toString();
          signal.redirectChain.push({ status: res.status, location: resolved });
          current = resolved;
          continue;
        }
        signal.finalStatus = res.status;
        signal.finalUrl = stripCacheBuster(current);
        const body = typeof res.data === 'string' ? res.data : '';
        signal.contentLength = body.length;
        signal.head = parseHeadSignal(body);
        signal.ok = true;
        break;
      }
      if (!signal.ok && signal.redirectChain.length > MAX_REDIRECT_HOPS) {
        signal.error = 'too_many_redirects';
      }
    } catch (err) {
      signal.error = (err as Error).message;
      signal.timedOut = isTimeout(err);
    }
    await sleep(THROTTLE_MS);
    return signal;
  }

  /** HEAD the homepage over TLS and read the peer certificate. */
  private headWithCert(host: string): Promise<{
    status: number | null;
    error: string | null;
    cert: HttpsSignal['cert'];
  }> {
    return new Promise((resolve) => {
      const cert: HttpsSignal['cert'] = {
        authorized: null, validTo: null, daysRemaining: null, issuer: null, error: null,
      };
      const req = https.request(
        {
          host,
          port: 443,
          method: 'HEAD',
          path: '/',
          timeout: FETCH_TIMEOUT_MS,
          // We inspect expired/broken certs instead of failing the handshake —
          // `authorized:false` + the reason IS the finding's evidence.
          rejectUnauthorized: false,
          agent: false,
          headers: { 'User-Agent': UA },
        },
        (res) => {
          try {
            const socket = res.socket as tls.TLSSocket;
            const peer = socket.getPeerCertificate();
            cert.authorized = socket.authorized;
            if (!socket.authorized && socket.authorizationError) {
              cert.error = String(socket.authorizationError);
            }
            if (peer && peer.valid_to) {
              cert.validTo = peer.valid_to;
              const t = Date.parse(peer.valid_to);
              if (!Number.isNaN(t)) {
                cert.daysRemaining = Math.floor((t - Date.now()) / 86_400_000);
              }
              cert.issuer = peer.issuer ? String(peer.issuer.O ?? peer.issuer.CN ?? '') || null : null;
            }
          } catch (err) {
            cert.error = (err as Error).message;
          }
          res.resume();
          resolve({ status: res.statusCode ?? null, error: null, cert });
        },
      );
      req.on('timeout', () => req.destroy(new Error('timeout')));
      req.on('error', (err) => {
        cert.error = cert.error ?? err.message;
        resolve({ status: null, error: err.message, cert });
      });
      req.end();
    });
  }
}

// ── helpers ──────────────────────────────────────────────────────────────────

function originOf(siteUrl: string): string {
  try {
    return new URL(siteUrl).origin;
  } catch {
    return siteUrl.replace(/\/+$/, '');
  }
}

function hostOf(siteUrl: string): string | null {
  try {
    return new URL(siteUrl).hostname;
  } catch {
    return null;
  }
}

function withCacheBuster(url: string): string {
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}cmsaudit=${Date.now()}`;
}

function stripCacheBuster(url: string): string {
  return url
    .replace(/[?&]cmsaudit=\d+/, '')
    .replace(/\?$/, '');
}

function isTimeout(err: unknown): boolean {
  const code = (err as { code?: string })?.code;
  const msg = (err as Error)?.message ?? '';
  return code === 'ECONNABORTED' || code === 'ETIMEDOUT' || /timeout/i.test(msg);
}

function toArray(v: unknown): any[] {
  if (v == null) return [];
  return Array.isArray(v) ? v : [v];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
