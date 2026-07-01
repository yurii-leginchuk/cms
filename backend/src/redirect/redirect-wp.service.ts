import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { Site } from '../sites/site.entity';
import { RawGroup, RawRedirect } from './redirect-normalize';

/** What the plugin's GET /redirects returns (already shaped by the WP side). */
export interface RedirectionFetch {
  /** true / false(plugin not active). Transport failures throw instead. */
  redirectionActive: boolean;
  pluginVersion: string | null;
  redirects: RawRedirect[];
  groups: RawGroup[];
}

/** The write payload the CMS sends the plugin (superset of the editable fields). */
export interface RedirectWritePayload {
  source: string;
  target?: string | null;
  actionCode?: number | null;
  actionType?: string | null;
  matchType?: string | null;
  regex?: boolean;
  groupId?: number | null;
  enabled?: boolean;
  title?: string | null;
}

/**
 * Result of a plugin write — the re-read row (proof of what landed), matching the
 * read-back idiom in class-poirier-api.php. `redirect` is null for a delete.
 */
export interface RedirectWriteResult {
  ok: boolean;
  redirect: RawRedirect | null;
}

/** Raised when the Redirection plugin isn't active — caller records a skip, not a failure. */
export class RedirectionInactiveError extends Error {
  constructor() {
    super('Redirection plugin is not active on this site.');
    this.name = 'RedirectionInactiveError';
  }
}

/** Raised when the site has no WP API key — the caller records this as a skip. */
export class RedirectNoApiKeyError extends Error {
  constructor() {
    super('No WP API key configured for this site.');
    this.name = 'RedirectNoApiKeyError';
  }
}

/**
 * Read-only client for the redirect bridge in our `poirier-cms` WP plugin
 * (Phase 1). Same transport contract as CachePurgeService: authenticate with
 * `X-Poirier-API-Key`, scrub errors to `HTTP <status>` / `WordPress unreachable`,
 * never leak internals. We deliberately talk to OUR plugin, not Redirection's
 * REST (which is cookie/nonce-gated).
 */
@Injectable()
export class RedirectWpService {
  private readonly logger = new Logger(RedirectWpService.name);

  /**
   * Fetch every redirect + group from the site. Throws {@link RedirectNoApiKeyError}
   * when unconfigured and a scrubbed Error on transport/HTTP failure; returns a
   * `redirectionActive:false` payload (no throw) when the plugin says Redirection
   * isn't installed — that's an honest "skipped", not a failure.
   */
  async fetchRedirects(site: Site): Promise<RedirectionFetch> {
    if (!site.wpApiKey) throw new RedirectNoApiKeyError();

    let data: {
      success?: boolean;
      skipped?: boolean;
      redirectionActive?: boolean;
      pluginVersion?: string | null;
      redirects?: RawRedirect[];
      groups?: RawGroup[];
    };
    try {
      const res = await axios.get(`${site.url}/wp-json/poirier-cms/v1/redirects`, {
        timeout: 20_000,
        headers: { 'X-Poirier-API-Key': site.wpApiKey },
      });
      data = res.data ?? {};
    } catch (err) {
      throw new Error(this.httpReason(err));
    }

    return {
      redirectionActive: data.redirectionActive === true,
      pluginVersion: data.pluginVersion ?? null,
      redirects: Array.isArray(data.redirects) ? data.redirects : [],
      groups: Array.isArray(data.groups) ? data.groups : [],
    };
  }

  // ── Writes (Phase 2) — all gated upstream; each re-reads and returns the row ──

  /** Create a redirect in the Redirection plugin; returns the resulting row. */
  createRedirect(site: Site, payload: RedirectWritePayload): Promise<RedirectWriteResult> {
    return this.write(site, 'post', '/redirects', payload);
  }

  /** Update a redirect by its plugin id; returns the resulting row. */
  updateRedirect(
    site: Site,
    pluginId: number,
    payload: RedirectWritePayload,
  ): Promise<RedirectWriteResult> {
    return this.write(site, 'post', `/redirects/${pluginId}`, payload);
  }

  /** Enable/disable a redirect by its plugin id; returns the resulting row. */
  setEnabled(site: Site, pluginId: number, enabled: boolean): Promise<RedirectWriteResult> {
    return this.write(site, 'post', `/redirects/${pluginId}`, { enabled } as RedirectWritePayload);
  }

  /** Delete a redirect by its plugin id; result.redirect is null on success. */
  deleteRedirect(site: Site, pluginId: number): Promise<RedirectWriteResult> {
    return this.write(site, 'delete', `/redirects/${pluginId}`, null);
  }

  /**
   * Shared write transport: same auth/scrubbing as fetch. Throws
   * {@link RedirectionInactiveError} when the plugin reports Redirection absent
   * (an honest skip), and a scrubbed Error on transport/HTTP failure.
   */
  private async write(
    site: Site,
    method: 'post' | 'delete',
    route: string,
    body: RedirectWritePayload | null,
  ): Promise<RedirectWriteResult> {
    if (!site.wpApiKey) throw new RedirectNoApiKeyError();

    let data: {
      success?: boolean;
      skipped?: boolean;
      redirectionActive?: boolean;
      redirect?: RawRedirect | null;
      deleted?: boolean;
    };
    try {
      const res = await axios.request({
        url: `${site.url}/wp-json/poirier-cms/v1${route}`,
        method,
        timeout: 20_000,
        headers: { 'X-Poirier-API-Key': site.wpApiKey, 'Content-Type': 'application/json' },
        data: body ?? undefined,
      });
      data = res.data ?? {};
    } catch (err) {
      throw new Error(this.httpReason(err));
    }

    if (data.redirectionActive === false || data.skipped === true) {
      throw new RedirectionInactiveError();
    }
    return { ok: data.success !== false, redirect: data.redirect ?? null };
  }

  /** Scrub an axios/transport error to a safe, human-readable reason. */
  private httpReason(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      return status ? `HTTP ${status}` : 'WordPress unreachable';
    }
    return (err as Error)?.message ?? 'Request failed';
  }
}
