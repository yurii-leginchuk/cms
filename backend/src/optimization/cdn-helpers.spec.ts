import {
  buildCustomDomainPayload,
  buildCdnUrl,
  mapCustomDomainStatus,
  buildPublishCandidates,
  PublishRowLike,
} from './cdn-helpers';
import { DnsStatus } from './site-optimization-config.entity';

describe('buildCustomDomainPayload', () => {
  it('builds the exact CF binding body (enabled + minTLS 1.2, domain lowercased)', () => {
    expect(buildCustomDomainPayload('CDN.Client.com', ' zone123 ')).toEqual({
      domain: 'cdn.client.com',
      zoneId: 'zone123',
      enabled: true,
      minTLS: '1.2',
    });
  });
});

describe('buildCdnUrl', () => {
  it('joins domain + key into an https URL', () => {
    expect(buildCdnUrl('cdn.x', 'img/a.webp')).toBe('https://cdn.x/img/a.webp');
  });
  it('strips a protocol, leading slash on key, and trailing slash on domain', () => {
    expect(buildCdnUrl('https://cdn.x/', '/img/a.webp')).toBe('https://cdn.x/img/a.webp');
  });
});

describe('mapCustomDomainStatus', () => {
  it('active only when enabled AND ownership+ssl active', () => {
    expect(mapCustomDomainStatus({ enabled: true, status: { ownership: 'active', ssl: 'active' } })).toBe(DnsStatus.ACTIVE);
  });
  it('pending while still provisioning', () => {
    expect(mapCustomDomainStatus({ enabled: true, status: { ownership: 'pending', ssl: 'initializing' } })).toBe(DnsStatus.PENDING);
  });
  it('pending when disabled even if active', () => {
    expect(mapCustomDomainStatus({ enabled: false, status: { ownership: 'active', ssl: 'active' } })).toBe(DnsStatus.PENDING);
  });
  it('error on a hard-failure state', () => {
    expect(mapCustomDomainStatus({ status: { ownership: 'blocked' } })).toBe(DnsStatus.ERROR);
    expect(mapCustomDomainStatus({ enabled: true, status: { ownership: 'active', ssl: 'error' } })).toBe(DnsStatus.ERROR);
  });
  it('pending for a null/unknown payload', () => {
    expect(mapCustomDomainStatus(null)).toBe(DnsStatus.PENDING);
  });
});

describe('buildPublishCandidates (gate #2 eligibility)', () => {
  const rows: PublishRowLike[] = [
    { imageId: 'a', r2Uploaded: true, r2Key: 'img/a.webp' },   // eligible
    { imageId: 'b', r2Uploaded: false, r2Key: 'img/b.webp' },  // not uploaded → excluded
    { imageId: 'c', r2Uploaded: true, r2Key: null },           // no key → excluded
    { imageId: 'd', r2Uploaded: true, r2Key: 'img/d.webp' },   // no attachment id → excluded
  ];
  const att = new Map<string, number | null>([
    ['a', 111],
    ['b', 222],
    ['c', 333],
    ['d', null],
  ]);

  it('includes only uploaded rows with a key AND a known attachment id', () => {
    const out = buildPublishCandidates(rows, att);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ imageId: 'a', wpAttachmentId: 111, r2Key: 'img/a.webp' });
  });
});
