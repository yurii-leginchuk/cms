import axios from 'axios';
import { OptimizationService } from './optimization.service';
import { R2Status } from './site-optimization-config.entity';
import { ImageOptimizationState } from './image-optimization.entity';
import { computeSettingsFingerprint } from './optimization-fingerprint';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

/**
 * Single-image (webhook) idempotency: the first call optimizes; a duplicate
 * webhook for the same, already-optimized attachment does NO work (never
 * re-touches an optimized image — new_only).
 */
describe('OptimizationService.optimizeSingleAttachment idempotency', () => {
  const ENC = 'v-libvips';
  const fingerprint = computeSettingsFingerprint({
    quality: 80, webpEnabled: true, maxWidth: 1600, encoderVersion: ENC,
  });

  function build() {
    const config = {
      siteId: 's', enabled: true, r2Status: R2Status.VERIFIED,
      quality: 80, webpEnabled: true, maxWidth: 1600, rewriteEnabled: false,
    };
    const image = { id: 'i1', canonicalUrl: 'http://wp/a.png', wpAttachmentId: 5 };

    const optimizedRow = {
      imageId: 'i1', state: ImageOptimizationState.OPTIMIZED, settingsFingerprint: fingerprint,
    };

    const optRepo = {
      // 1st call → no row yet; 2nd call → already optimized under current settings
      findOne: jest.fn()
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(optimizedRow),
      create: jest.fn((o: unknown) => ({ ...(o as object) })),
      save: jest.fn(async (r: unknown) => r),
    };
    const imageRepo = { findOne: jest.fn().mockResolvedValue(image) };
    const configService = {
      getOrCreate: jest.fn().mockResolvedValue(config),
      getDecryptedCreds: jest.fn().mockReturnValue(null), // no upload in this test
    };
    const processing = {
      encoderVersion: jest.fn().mockReturnValue(ENC),
      process: jest.fn().mockResolvedValue({
        outcome: 'optimized', format: 'webp', width: 100, height: 80,
        originalBytes: 1000, optimizedBytes: 400, buffer: Buffer.from('opt'),
      }),
    };
    const wpMediaService = { ingest: jest.fn().mockResolvedValue({}) };
    const svc = new OptimizationService(
      {} as never, imageRepo as never, optRepo as never, {} as never,
      configService as never, processing as never, wpMediaService as never,
      {} as never, {} as never,
    );
    return { svc, processing, optRepo };
  }

  it('optimizes once, then no-ops on a duplicate webhook', async () => {
    mockedAxios.get.mockResolvedValue({ data: Buffer.from('rawpng') } as never);
    const { svc, processing } = build();

    const first = await svc.optimizeSingleAttachment('s', 5);
    expect(first.status).toBe('optimized');
    expect(processing.process).toHaveBeenCalledTimes(1);

    const second = await svc.optimizeSingleAttachment('s', 5);
    expect(second.status).toBe('already_optimized');
    // No second encode — the already-optimized image was NOT re-touched.
    expect(processing.process).toHaveBeenCalledTimes(1);
  });

  it('noops without any work when optimization is disabled', async () => {
    const config = { siteId: 's', enabled: false, r2Status: R2Status.VERIFIED };
    const processing = { encoderVersion: jest.fn(), process: jest.fn() };
    const svc = new OptimizationService(
      {} as never, { findOne: jest.fn() } as never, { findOne: jest.fn() } as never, {} as never,
      { getOrCreate: jest.fn().mockResolvedValue(config) } as never,
      processing as never, { ingest: jest.fn() } as never, {} as never, {} as never,
    );
    const res = await svc.optimizeSingleAttachment('s', 5);
    expect(res.status).toBe('skipped_disabled');
    expect(processing.process).not.toHaveBeenCalled();
  });
});
