import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { mapCfError } from './r2-helpers';

/**
 * Cloudflare R2 bucket administration via the CF REST API using the per-site
 * CF API token (Workers R2 Storage: Edit). Phase 2 only creates the bucket;
 * Phase 3 will add custom-domain binding here.
 *
 * The token is passed in decrypted and is NEVER logged.
 */
@Injectable()
export class CloudflareR2AdminService {
  private readonly logger = new Logger(CloudflareR2AdminService.name);

  /**
   * Create the bucket. Idempotent: an already-existing bucket (409 / code 10004)
   * is treated as success so re-running setup reuses it rather than erroring.
   */
  async createBucket(
    accountId: string,
    token: string,
    name: string,
  ): Promise<{ created: boolean; existed: boolean }> {
    try {
      await axios.post(
        `https://api.cloudflare.com/client/v4/accounts/${accountId}/r2/buckets`,
        { name },
        {
          headers: { Authorization: `Bearer ${token}` },
          timeout: 15_000,
        },
      );
      return { created: true, existed: false };
    } catch (err) {
      if (axios.isAxiosError(err)) {
        const status = err.response?.status;
        const errors = err.response?.data?.errors as
          | { code?: number; message?: string }[]
          | undefined;
        const code = Array.isArray(errors) ? errors[0]?.code : undefined;
        const message = Array.isArray(errors) ? errors[0]?.message ?? '' : '';

        if (status === 409 || code === 10004 || /already (exists|owned)/i.test(message)) {
          return { created: false, existed: true };
        }
        // Never include the token or full response body — only a mapped reason.
        this.logger.warn(`Bucket create failed (status ${status ?? 'n/a'})`);
        throw new Error(mapCfError(status, message));
      }
      throw new Error('Cloudflare request failed.');
    }
  }
}
