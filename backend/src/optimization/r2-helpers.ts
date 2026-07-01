/**
 * Pure R2/Cloudflare helpers — no I/O, fully unit-tested.
 *   - deriveBucketName: site domain/slug → a DNS-safe R2 bucket name.
 *   - mapS3Error / mapCfError: SDK/HTTP errors → a specific human reason, with
 *     NO raw error body or secret leaking through (requirement #7's ALERT text).
 */

/** Decrypted credentials handed to the S3 client (never persisted in this shape). */
export interface R2Credentials {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

/**
 * Derive a valid R2/S3 bucket name from a site domain, slug, or override:
 * lowercase, only [a-z0-9-], collapsed hyphens, trimmed, clamped to 3-63 chars,
 * starting/ending alphanumeric.
 */
export function deriveBucketName(input: string): string {
  let s = (input || '')
    .toLowerCase()
    .trim()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/\/.*$/, '') // drop any path
    .replace(/[^a-z0-9-]+/g, '-') // non-safe → hyphen
    .replace(/-+/g, '-') // collapse
    .replace(/^-+|-+$/g, ''); // trim hyphens

  if (!s) s = 'site';
  if (s.length > 63) s = s.slice(0, 63).replace(/-+$/, '');
  if (s.length < 3) s = (s + 'xxx').slice(0, 3);
  return s;
}

interface ErrorLike {
  name?: string;
  code?: string;
  Code?: string;
  message?: string;
  statusCode?: number;
  $metadata?: { httpStatusCode?: number };
}

/** Map an S3/R2 SDK error to a specific, secret-free human reason. */
export function mapS3Error(err: unknown): string {
  const e = (err ?? {}) as ErrorLike;
  const name = e.name ?? e.Code ?? e.code ?? '';
  const status = e.$metadata?.httpStatusCode ?? e.statusCode;

  if (name === 'InvalidAccessKeyId') {
    return 'R2 credentials rejected: access key ID not recognized.';
  }
  if (name === 'SignatureDoesNotMatch') {
    return 'R2 credentials rejected: secret access key is incorrect.';
  }
  if (name === 'NoSuchBucket' || status === 404) {
    return 'Bucket not found — create the bucket first.';
  }
  if (name === 'AccessDenied' || status === 403) {
    return 'Access denied — the R2 key lacks permission for this bucket.';
  }
  if (status === 401) {
    return 'R2 credentials rejected (unauthorized).';
  }
  if (
    ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN', 'TimeoutError'].includes(
      name,
    ) ||
    ['ENOTFOUND', 'ECONNREFUSED', 'ETIMEDOUT', 'EAI_AGAIN'].includes(e.code ?? '')
  ) {
    return 'Network error reaching R2 — check the Account ID and connectivity.';
  }
  return 'R2 connection failed.';
}

/** Map a Cloudflare REST error (bucket create) to a secret-free human reason. */
export function mapCfError(status?: number, message?: string): string {
  if (status === 401 || status === 403) {
    return 'Cloudflare API token rejected — it needs the Workers R2 Storage: Edit permission.';
  }
  if (status === 400) {
    const detail = message ? `: ${message.slice(0, 120)}` : '';
    return `Cloudflare rejected the bucket request${detail}.`;
  }
  return 'Cloudflare bucket creation failed.';
}
