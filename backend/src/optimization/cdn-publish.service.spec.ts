import axios from 'axios';
import { CdnPublishService } from './cdn-publish.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Gate #2: only images that are r2Uploaded AND whose CDN URL HEAD-checks 200
 * get published + marked rewriteLive. HTTP is mocked (no live CDN).
 */
describe('CdnPublishService.publish', () => {
  beforeEach(() => jest.clearAllMocks());

  it('publishes ONLY uploaded rows whose CDN URL returns 200; others stay original', async () => {
    const rowA = { imageId: 'a', r2Uploaded: true, r2Key: 'img/a.webp', rewriteLive: false, rewriteVerifiedAt: null };
    const rowB = { imageId: 'b', r2Uploaded: true, r2Key: 'img/b.webp', rewriteLive: false, rewriteVerifiedAt: null };
    const rowD = { imageId: 'd', r2Uploaded: true, r2Key: 'img/d.webp', rewriteLive: false, rewriteVerifiedAt: null };

    const optRepo = {
      find: jest.fn().mockResolvedValue([rowA, rowB, rowD]),
      save: jest.fn(async (r: unknown) => r),
    };
    const imageRepo = {
      find: jest.fn().mockResolvedValue([
        { id: 'a', wpAttachmentId: 111 },
        { id: 'b', wpAttachmentId: 222 },
        { id: 'd', wpAttachmentId: null }, // no attachment → not a candidate
      ]),
    };
    const siteRepo = {} as never;

    // HEAD: a.webp → 200 (verified), b.webp → 404 (not verified)
    mockedAxios.head.mockImplementation((url: string) =>
      Promise.resolve({ status: url.includes('a.webp') ? 200 : 404 }),
    );
    mockedAxios.post.mockResolvedValue({ data: { success: true } });

    const svc = new CdnPublishService(siteRepo, imageRepo as never, optRepo as never);
    const config = { siteId: 's', cdnDomain: 'cdn.x' } as never;
    const site = { url: 'http://wp.local', wpApiKey: 'key' } as never;

    const res = await svc.publish(config, site);

    // D excluded (no attachment) → 2 eligible; only A verified.
    expect(res.eligible).toBe(2);
    expect(res.verified).toBe(1);
    expect(res.failedHead).toBe(1);

    expect(rowA.rewriteLive).toBe(true);
    expect(rowA.rewriteVerifiedAt).toBeInstanceOf(Date);
    expect(rowB.rewriteLive).toBe(false);

    // Exactly one map push, containing only the verified mapping.
    expect(mockedAxios.post).toHaveBeenCalledTimes(1);
    const body = mockedAxios.post.mock.calls[0][1] as { mappings: { wpAttachmentId: number; cdnUrl: string }[] };
    expect(body.mappings).toEqual([{ wpAttachmentId: 111, cdnUrl: 'https://cdn.x/img/a.webp' }]);
  });

  it('pushes nothing when no row verifies', async () => {
    const rowA = { imageId: 'a', r2Uploaded: true, r2Key: 'img/a.webp', rewriteLive: false, rewriteVerifiedAt: null };
    const optRepo = {
      find: jest.fn().mockResolvedValue([rowA]),
      save: jest.fn(async (r: unknown) => r),
    };
    const imageRepo = { find: jest.fn().mockResolvedValue([{ id: 'a', wpAttachmentId: 111 }]) };
    mockedAxios.head.mockResolvedValue({ status: 500 } as never);
    mockedAxios.post.mockResolvedValue({ data: {} } as never);

    const svc = new CdnPublishService({} as never, imageRepo as never, optRepo as never);
    const res = await svc.publish({ siteId: 's', cdnDomain: 'cdn.x' } as never, { url: 'http://wp', wpApiKey: 'k' } as never);

    expect(res.verified).toBe(0);
    expect(mockedAxios.post).not.toHaveBeenCalled();
    expect(rowA.rewriteLive).toBe(false);
  });
});
