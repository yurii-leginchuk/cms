import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios from 'axios';
import { Site } from '../sites/site.entity';
import { OptimizationConfigService } from '../optimization/optimization-config.service';
import { CloudflareCdnService } from '../optimization/cloudflare-cdn.service';

export type PurgeLayer = 'plugin' | 'wpengine' | 'cloudflare';
export type PurgeStatus = 'success' | 'skipped' | 'failed';

export interface PurgeLayerResult {
  layer: PurgeLayer;
  label: string;
  status: PurgeStatus;
  /** Human-readable detail (method used, skip reason, or scrubbed error). */
  detail?: string;
}

export interface PurgeCacheResult {
  siteId: string;
  results: PurgeLayerResult[];
}

/**
 * "Purge cache everywhere" orchestrator.
 *
 * Purges each caching layer a site uses, in STRICT order:
 *   1. WordPress plugin cache (WP Fastest Cache) — via our plugin REST.
 *   2. WP Engine cache — only when the site's hostedOnWpEngine flag is on.
 *   3. Cloudflare zone cache — reusing the image-optimization module's encrypted
 *      per-site CF token + zone id (no second credential system).
 *
 * The layers are INDEPENDENT: each helper catches its own errors and returns a
 * result — it NEVER throws — so one failure can't abort the others. A layer that
 * isn't configured/applicable is "skipped", not "failed".
 */
@Injectable()
export class CachePurgeService {
  private readonly logger = new Logger(CachePurgeService.name);

  constructor(
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    private readonly optimizationConfig: OptimizationConfigService,
    private readonly cloudflare: CloudflareCdnService,
  ) {}

  async purgeAll(siteId: string): Promise<PurgeCacheResult> {
    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    if (!site) throw new NotFoundException(`Site ${siteId} not found`);

    // Sequential + independent: order matters, but a failure never short-circuits.
    const results: PurgeLayerResult[] = [];
    results.push(await this.purgePlugin(site));
    results.push(await this.purgeWpEngine(site));
    results.push(await this.purgeCloudflare(site));

    return { siteId, results };
  }

  // ── Layer 1: WordPress plugin (WP Fastest Cache) ───────────────────────────
  private async purgePlugin(site: Site): Promise<PurgeLayerResult> {
    const label = 'WordPress (WP Fastest Cache)';
    if (!site.wpApiKey) {
      return { layer: 'plugin', label, status: 'skipped', detail: 'No WP API key configured' };
    }
    try {
      const { data } = await axios.post(
        `${site.url}/wp-json/poirier-cms/v1/purge-cache`,
        { target: 'wp' },
        {
          timeout: 15_000,
          headers: { 'Content-Type': 'application/json', 'X-Poirier-API-Key': site.wpApiKey },
        },
      );
      const methods = Array.isArray(data?.methods) ? data.methods.join(', ') : '';
      return {
        layer: 'plugin',
        label,
        status: 'success',
        detail: methods ? `Purged: ${methods}` : 'Purged',
      };
    } catch (err) {
      return { layer: 'plugin', label, status: 'failed', detail: this.httpReason(err) };
    }
  }

  // ── Layer 2: WP Engine (flag-gated) ────────────────────────────────────────
  private async purgeWpEngine(site: Site): Promise<PurgeLayerResult> {
    const label = 'WP Engine';
    if (!site.hostedOnWpEngine) {
      return { layer: 'wpengine', label, status: 'skipped', detail: 'Not enabled for this site' };
    }
    if (!site.wpApiKey) {
      return { layer: 'wpengine', label, status: 'skipped', detail: 'No WP API key configured' };
    }
    try {
      const { data } = await axios.post(
        `${site.url}/wp-json/poirier-cms/v1/purge-cache`,
        { target: 'wpengine' },
        {
          timeout: 15_000,
          headers: { 'Content-Type': 'application/json', 'X-Poirier-API-Key': site.wpApiKey },
        },
      );
      // The plugin reports skipped=true when WP Engine isn't actually detected on the host.
      if (data?.skipped) {
        return {
          layer: 'wpengine',
          label,
          status: 'skipped',
          detail: typeof data?.reason === 'string' ? data.reason : 'WP Engine not detected on host',
        };
      }
      const methods = Array.isArray(data?.methods) ? data.methods.join(', ') : '';
      return {
        layer: 'wpengine',
        label,
        status: 'success',
        detail: methods ? `Purged: ${methods}` : 'Purged',
      };
    } catch (err) {
      return { layer: 'wpengine', label, status: 'failed', detail: this.httpReason(err) };
    }
  }

  // ── Layer 3: Cloudflare zone (reuses optimization creds) ───────────────────
  private async purgeCloudflare(site: Site): Promise<PurgeLayerResult> {
    const label = 'Cloudflare';
    try {
      const config = await this.optimizationConfig.getOrCreate(site.id);
      const token = this.optimizationConfig.decryptCfToken(config);
      const zoneId = config.cfZoneId;
      if (!token || !zoneId) {
        return {
          layer: 'cloudflare',
          label,
          status: 'skipped',
          detail: 'No Cloudflare credentials / zone configured',
        };
      }
      await this.cloudflare.purgeEverything(zoneId, token);
      return { layer: 'cloudflare', label, status: 'success', detail: 'Purged everything' };
    } catch (err) {
      return {
        layer: 'cloudflare',
        label,
        status: 'failed',
        detail: err instanceof Error ? err.message : 'Cloudflare request failed',
      };
    }
  }

  private httpReason(err: unknown): string {
    if (axios.isAxiosError(err)) {
      const status = err.response?.status;
      return status ? `HTTP ${status}` : 'WordPress unreachable';
    }
    return (err as Error)?.message ?? 'Request failed';
  }
}
