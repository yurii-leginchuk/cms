import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import {
  S3Client,
  PutObjectCommand,
  HeadObjectCommand,
  DeleteObjectCommand,
  HeadBucketCommand,
  S3ClientConfig,
} from '@aws-sdk/client-s3';
import { R2Credentials } from './r2-helpers';

/**
 * Cloudflare R2 access via the S3-compatible API (@aws-sdk/client-s3, PINNED).
 * Takes DECRYPTED credentials per call — it never reads config or persists
 * anything, so it stays a leaf dependency (no cycles) and is easy to mock.
 *
 * `requestChecksumCalculation: 'WHEN_REQUIRED'` guards against the SDK CRC32
 * checksum behaviour R2 rejects (ResearchPack §2). Public reads need no
 * presigning (Phase 3 serves via a custom domain).
 */
@Injectable()
export class R2Service {
  private clientFor(c: R2Credentials): S3Client {
    const config: S3ClientConfig = {
      region: 'auto',
      endpoint: `https://${c.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: c.accessKeyId,
        secretAccessKey: c.secretAccessKey,
      },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    };
    return new S3Client(config);
  }

  async put(
    c: R2Credentials,
    key: string,
    body: Buffer,
    contentType: string,
  ): Promise<void> {
    await this.clientFor(c).send(
      new PutObjectCommand({
        Bucket: c.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
        // Content-hashed keys → safe to cache forever.
        CacheControl: 'public, max-age=31536000, immutable',
      }),
    );
  }

  async headObject(c: R2Credentials, key: string): Promise<void> {
    await this.clientFor(c).send(
      new HeadObjectCommand({ Bucket: c.bucket, Key: key }),
    );
  }

  async deleteObject(c: R2Credentials, key: string): Promise<void> {
    await this.clientFor(c).send(
      new DeleteObjectCommand({ Bucket: c.bucket, Key: key }),
    );
  }

  /** Cheap bucket existence / credential probe. */
  async bucketHealth(c: R2Credentials): Promise<void> {
    await this.clientFor(c).send(new HeadBucketCommand({ Bucket: c.bucket }));
  }

  /**
   * Real end-to-end write+read+delete round-trip — the authoritative
   * "is R2 actually usable?" check behind the Test Connection button. Throws
   * (mapped by the caller) on any failure.
   */
  async roundTrip(c: R2Credentials): Promise<void> {
    const key = `__poirier-healthcheck/${randomUUID()}.txt`;
    const body = Buffer.from('poirier-cms healthcheck');
    await this.put(c, key, body, 'text/plain');
    await this.headObject(c, key);
    await this.deleteObject(c, key);
  }
}
