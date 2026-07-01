import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Site } from '../sites/site.entity';
import { RedirectItem } from './redirect-item.entity';

/** One observed hop in the live redirect trail. */
export interface ResolveHop {
  hop: number;
  url: string;
  status: number;
}

export interface ResolveResult {
  startUrl: string;
  trail: ResolveHop[];
  finalUrl: string;
  finalStatus: number | null;
  hops: number;
  /** The live trail revisited a url — a real redirect loop. */
  loop: boolean;
  /** Budget ran out mid-walk (partial trail). */
  budgetExhausted: boolean;
  error: string | null;
  cached: boolean;
  checkedAt: string;
}

const MAX_HOPS = 10;
const TIMEOUT_MS = 15_000;
const CACHE_TTL_MS = 5 * 60_000;
/** Rolling outbound-fetch budget: at most this many live GETs per window. */
const BUDGET_MAX = 150;
const BUDGET_WINDOW_MS = 60_000;

/**
 * Live redirect resolver — follows the REAL HTTP chain (not the DB rows), because
 * the DB may say A→B while reality is A→B→C→404 (CDN/.htaccess/WP-core hops). This
 * is what makes flatten SAFE.
 *
 * Reuses the request contract from `SchemaQcService.fetchLive` (cache-busting
 * query param, `User-Agent: CMS-Bot/1.0`, no-cache headers, 15s timeout) but walks
 * hops manually with `maxRedirects: 0` so each hop's status + `Location` is
 * observable. Outbound fetches are budgeted (rolling per-minute cap) and results
 * are cached with a short TTL so re-runs are cheap.
 */
@Injectable()
export class RedirectResolveService {
  private readonly logger = new Logger(RedirectResolveService.name);
  private readonly cache = new Map<string, { result: ResolveResult; at: number }>();
  private fetchTimes: number[] = [];

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(RedirectItem) private readonly itemRepo: Repository<RedirectItem>,
  ) {}

  /** Resolve a known redirect by id and persist the result onto the item. */
  async resolveRedirect(siteId: string, redirectId: string): Promise<ResolveResult> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException('Site not found');
    const item = await this.itemRepo.findOne({ where: { id: redirectId, siteId } });
    if (!item) throw new NotFoundException('Redirect not found');
    if (item.regex) {
      // A regex source is a PATTERN, not a URL — fetching it verbatim would
      // "resolve" a meaningless address and persist a bogus live status.
      throw new BadRequestException(
        'Regex redirects cannot be live-resolved — the source is a pattern, not a URL.',
      );
    }

    const start = this.absoluteUrl(site.url, item.source);
    const result = await this.resolveUrl(site.url, start);

    // Persist the live snapshot onto the projection (best-effort).
    try {
      await this.itemRepo.update(
        { id: item.id },
        {
          liveFinalStatus: result.finalStatus,
          liveFinalUrl: result.finalUrl,
          liveHops: result.hops,
          liveTrail: result.trail,
          liveCheckedAt: new Date(),
        },
      );
    } catch (err) {
      this.logger.warn(`Could not persist live-resolve for ${item.id}: ${(err as Error).message}`);
    }
    return result;
  }

  /**
   * Resolve an absolute url by walking its redirect chain over HTTP. Cache-first;
   * a cache MISS consumes the outbound budget. Never throws on HTTP status — a
   * 404/500 final is a legitimate result the caller wants to see.
   */
  async resolveUrl(siteBase: string, startUrl: string): Promise<ResolveResult> {
    const key = this.stripBust(startUrl);
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) {
      return { ...hit.result, cached: true };
    }

    const trail: ResolveHop[] = [];
    const visited = new Set<string>();
    let current = startUrl;
    let loop = false;
    let budgetExhausted = false;
    let error: string | null = null;

    for (let i = 0; i < MAX_HOPS; i++) {
      // Loop check BEFORE reserving budget — a detected loop makes no request.
      const canon = this.stripBust(current);
      if (visited.has(canon)) { loop = true; break; }

      if (!this.reserveFetch()) { budgetExhausted = true; break; }
      visited.add(canon);

      let status: number;
      let location: string | undefined;
      try {
        const res = await axios.get(this.bust(current), {
          timeout: TIMEOUT_MS,
          maxRedirects: 0,
          maxContentLength: 5 * 1024 * 1024,
          validateStatus: () => true,
          headers: {
            'User-Agent': 'CMS-Bot/1.0',
            'Cache-Control': 'no-cache',
            Pragma: 'no-cache',
          },
        });
        status = res.status;
        const loc = res.headers?.location;
        location = Array.isArray(loc) ? loc[0] : (loc as string | undefined);
      } catch (err) {
        error = this.scrub(err);
        trail.push({ hop: i, url: canon, status: 0 });
        break;
      }

      trail.push({ hop: i, url: canon, status });

      if (status >= 300 && status < 400 && location) {
        current = this.resolveLocation(current, location);
        continue;
      }
      break; // reached a non-redirect final response
    }

    const last = trail[trail.length - 1];
    const result: ResolveResult = {
      startUrl: this.stripBust(startUrl),
      trail,
      finalUrl: last ? last.url : this.stripBust(startUrl),
      finalStatus: last ? last.status : null,
      hops: Math.max(0, trail.length - 1),
      loop,
      budgetExhausted,
      error,
      cached: false,
      checkedAt: new Date().toISOString(),
    };

    // Only cache complete (non-budget-limited) results.
    if (!budgetExhausted) this.cache.set(key, { result, at: Date.now() });
    return result;
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /** Rolling per-window budget. Returns false when the cap is hit. */
  private reserveFetch(): boolean {
    const now = Date.now();
    this.fetchTimes = this.fetchTimes.filter((t) => now - t < BUDGET_WINDOW_MS);
    if (this.fetchTimes.length >= BUDGET_MAX) return false;
    this.fetchTimes.push(now);
    return true;
  }

  /** Make a redirect source absolute against the site base. */
  private absoluteUrl(siteBase: string, source: string): string {
    const s = (source ?? '').trim();
    if (/^https?:\/\//i.test(s)) return s;
    const base = siteBase.replace(/\/+$/, '');
    return `${base}${s.startsWith('/') ? '' : '/'}${s}`;
  }

  private resolveLocation(current: string, location: string): string {
    try {
      return new URL(location, this.stripBust(current)).toString();
    } catch {
      return location;
    }
  }

  private bust(url: string): string {
    return `${url}${url.includes('?') ? '&' : '?'}_poirierlrc=${Date.now()}`;
  }

  /** Remove our cache-busting param so loop detection + display are canonical. */
  private stripBust(url: string): string {
    return url.replace(/([?&])_poirierlrc=\d+(&|$)/, (_m, p1, p2) => (p2 === '&' ? p1 : '')).replace(/[?&]$/, '');
  }

  private scrub(err: unknown): string {
    if (axios.isAxiosError(err)) {
      if (err.code === 'ECONNABORTED') return 'Timed out';
      return err.response?.status ? `HTTP ${err.response.status}` : 'Unreachable';
    }
    return (err as Error)?.message ?? 'Request failed';
  }
}
