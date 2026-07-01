import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { mapCfError } from './r2-helpers';
import {
  buildCustomDomainPayload,
  mapCustomDomainStatus,
  CustomDomainStatusResult,
} from './cdn-helpers';
import { DnsStatus } from './site-optimization-config.entity';

/**
 * Cloudflare R2 custom-domain automation. Binding a custom domain to the bucket
 * (same-account zone) makes Cloudflare AUTO-PROVISION the proxied DNS record +
 * TLS — so we do NOT touch the DNS API separately (ResearchPack §3).
 *
 * Uses the per-site CF API token (Workers R2 Storage: Edit + DNS: Edit + Zone:
 * Read). The token is passed in decrypted and is NEVER logged; errors are
 * scrubbed to a human reason before they reach the DB.
 */
@Injectable()
export class CloudflareCdnService {
  private readonly logger = new Logger(CloudflareCdnService.name);

  private base(accountId: string, bucket: string): string {
    return `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets/${bucket}/domains/custom`;
  }

  /**
   * Bind the custom domain to the bucket. Idempotent: an already-bound domain
   * (409 / already-exists) is treated as success. Returns nothing on success;
   * throws a scrubbed Error on failure.
   */
  async bindCustomDomain(
    accountId: string,
    token: string,
    bucket: string,
    domain: string,
    zoneId: string,
  ): Promise<void> {
    try {
      await axios.post(this.base(accountId, bucket), buildCustomDomainPayload(domain, zoneId), {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 15_000,
      });
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const errors = err.response?.data?.errors as
          | { code?: number; message?: string }[]
          | undefined;
        const code = Array.isArray(errors) ? errors[0]?.code : undefined;
        const message = Array.isArray(errors) ? errors[0]?.message ?? '' : '';
        if (status === 409 || /already (exists|bound|owned)/i.test(message) || code === 10004) {
          return; // already bound → success
        }
        this.logger.warn(`Custom-domain bind failed (status ${status ?? 'n/a'})`);
        throw new Error(mapCfError(status, message));
      }
      throw new Error('Cloudflare request failed.');
    }
  }

  /**
   * Purge the ENTIRE Cloudflare cache for a zone (POST /zones/:id/purge_cache
   * with { purge_everything: true }). Reuses the per-site CF API token stored by
   * the image-optimization module — that token needs the "Cache Purge" permission
   * on the zone (in addition to its R2/DNS scopes) for this call to succeed.
   *
   * Throws a scrubbed Error on failure; the token is never logged.
   */
  async purgeEverything(zoneId: string, token: string): Promise<void> {
    try {
      await axios.post(
        `https://api.cloudflare.com/client/v4/zones/${zoneId}/purge_cache`,
        { purge_everything: true },
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
      );
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const errors = err.response?.data?.errors as { message?: string }[] | undefined;
        const message = Array.isArray(errors) ? errors[0]?.message ?? '' : '';
        this.logger.warn(`Zone cache purge failed (status ${status ?? 'n/a'})`);
        throw new Error(mapCfError(status, message));
      }
      throw new Error('Cloudflare request failed.');
    }
  }

  /** Poll the custom-domain status and map it to our DnsStatus. */
  async getCustomDomainStatus(
    accountId: string,
    token: string,
    bucket: string,
    domain: string,
  ): Promise<DnsStatus> {
    try {
      const { data } = await axios.get(
        `${this.base(accountId, bucket)}/${encodeURIComponent(domain)}`,
        { headers: { Authorization: `Bearer ${token}` }, timeout: 15_000 },
      );
      const result = (data?.result ?? null) as CustomDomainStatusResult | null;
      return mapCustomDomainStatus(result);
    } catch (err) {
      if (axios.isAxiosError(err)) {
        this.logger.warn(
          `Custom-domain status check failed (status ${err.response?.status ?? 'n/a'})`,
        );
      }
      return DnsStatus.ERROR;
    }
  }
}
