import { DnsStatus } from './site-optimization-config.entity';

/**
 * Pure CDN/custom-domain helpers — no I/O, fully unit-tested.
 */

/** Body for the R2 custom-domain binding call (auto-provisions DNS + TLS). */
export interface CustomDomainPayload {
  domain: string;
  zoneId: string;
  enabled: true;
  minTLS: '1.2';
}

export function buildCustomDomainPayload(
  domain: string,
  zoneId: string,
): CustomDomainPayload {
  return { domain: domain.trim().toLowerCase(), zoneId: zoneId.trim(), enabled: true, minTLS: '1.2' };
}

/** The public CDN URL for an optimized object. */
export function buildCdnUrl(cdnDomain: string, r2Key: string): string {
  const host = cdnDomain.trim().replace(/^https?:\/\//, '').replace(/\/+$/, '');
  const key = r2Key.replace(/^\/+/, '');
  return `https://${host}/${key}`;
}

/** Shape of the Cloudflare GET custom-domain status result we branch on. */
export interface CustomDomainStatusResult {
  enabled?: boolean;
  status?: { ownership?: string; ssl?: string };
}

/**
 * Map Cloudflare's custom-domain status → our DnsStatus.
 *   active  = enabled AND ownership active AND ssl active
 *   error   = a hard-failure ownership/ssl state
 *   pending = anything still in progress
 */
export function mapCustomDomainStatus(
  result: CustomDomainStatusResult | null | undefined,
): DnsStatus {
  if (!result) return DnsStatus.PENDING;
  const ownership = (result.status?.ownership ?? '').toLowerCase();
  const ssl = (result.status?.ssl ?? '').toLowerCase();

  const errorStates = ['blocked', 'deactivated', 'error', 'deleted', 'timed_out'];
  if (errorStates.includes(ownership) || errorStates.includes(ssl)) {
    return DnsStatus.ERROR;
  }
  if (result.enabled && ownership === 'active' && ssl === 'active') {
    return DnsStatus.ACTIVE;
  }
  return DnsStatus.PENDING;
}

/** A row that MIGHT be publishable to the CDN map. */
export interface PublishRowLike {
  imageId: string;
  r2Uploaded: boolean;
  r2Key: string | null;
}

export interface PublishCandidate {
  imageId: string;
  wpAttachmentId: number;
  r2Key: string;
}

/**
 * Pure eligibility filter: only rows that are actually uploaded to R2, have a
 * key, AND map to a known WordPress attachment id can be published. (The HEAD-200
 * check happens after this, in the service.) This is the core of gate #2 —
 * nothing without a real, addressable artifact ever reaches the plugin.
 */
export function buildPublishCandidates(
  rows: PublishRowLike[],
  attachmentByImageId: Map<string, number | null | undefined>,
): PublishCandidate[] {
  const out: PublishCandidate[] = [];
  for (const r of rows) {
    if (!r.r2Uploaded || !r.r2Key) continue;
    const att = attachmentByImageId.get(r.imageId);
    if (att === null || att === undefined) continue;
    out.push({ imageId: r.imageId, wpAttachmentId: Number(att), r2Key: r.r2Key });
  }
  return out;
}
