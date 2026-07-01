import { timingSafeEqual } from 'crypto';

/**
 * Constant-time comparison of a provided webhook secret against the stored one.
 * Returns false for a missing/empty secret or a length mismatch WITHOUT leaking
 * timing on the compare itself. Pure — unit tested.
 */
export function verifyWebhookSecret(
  provided: string | null | undefined,
  stored: string | null | undefined,
): boolean {
  if (!provided || !stored) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(stored);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
