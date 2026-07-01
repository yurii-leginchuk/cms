import {
  ImageProcessingService,
  classifySkip,
  sha256,
} from './image-processing.service';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as typeof import('sharp').default;

jest.setTimeout(30_000);

/** Incompressible RGB noise → a PNG that is guaranteed larger than a lossy re-encode. */
async function noisePng(width: number, height: number): Promise<Buffer> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < raw.length; i++) raw[i] = Math.floor(Math.random() * 256);
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

describe('classifySkip (pure)', () => {
  it('skips SVG', () => {
    expect(classifySkip({ format: 'svg' })).toBe('svg');
  });
  it('skips animated (pages > 1)', () => {
    expect(classifySkip({ format: 'gif', pages: 12 })).toBe('animated');
    expect(classifySkip({ format: 'webp', pages: 2 })).toBe('animated');
  });
  it('processes a normal single-frame raster', () => {
    expect(classifySkip({ format: 'jpeg', pages: 1 })).toBeNull();
    expect(classifySkip({ format: 'png' })).toBeNull();
  });
});

describe('sha256 (pure)', () => {
  it('is deterministic and content-sensitive', () => {
    expect(sha256(Buffer.from('abc'))).toBe(sha256(Buffer.from('abc')));
    expect(sha256(Buffer.from('abc'))).not.toBe(sha256(Buffer.from('abd')));
    expect(sha256(Buffer.from('abc'))).toHaveLength(64);
  });
});

describe('ImageProcessingService.process', () => {
  const svc = new ImageProcessingService();

  it('converts to WebP and shrinks a compressible photo', async () => {
    const png = await noisePng(600, 400);
    const res = await svc.process(png, {
      webpEnabled: true,
      quality: 80,
      maxWidth: 1600,
    });
    expect(res.outcome).toBe('optimized');
    expect(res.format).toBe('webp');
    expect(res.optimizedBytes).toBeLessThan(res.originalBytes);
    expect(res.buffer).toBeInstanceOf(Buffer);
  });

  it('falls back to mozjpeg when WebP is disabled', async () => {
    const png = await noisePng(600, 400);
    const res = await svc.process(png, {
      webpEnabled: false,
      quality: 80,
      maxWidth: 1600,
    });
    expect(res.outcome).toBe('optimized');
    expect(res.format).toBe('jpeg');
    expect(res.optimizedBytes).toBeLessThan(res.originalBytes);
  });

  it('downscales images WIDER than maxWidth', async () => {
    const wide = await noisePng(2000, 1000);
    const res = await svc.process(wide, {
      webpEnabled: true,
      quality: 80,
      maxWidth: 1600,
    });
    expect(res.outcome).toBe('optimized');
    expect(res.width).toBe(1600);
  });

  it('leaves images NARROWER than maxWidth untouched (withoutEnlargement)', async () => {
    const narrow = await noisePng(800, 600);
    const res = await svc.process(narrow, {
      webpEnabled: true,
      quality: 80,
      maxWidth: 1600,
    });
    expect(res.outcome).toBe('optimized');
    expect(res.width).toBe(800); // NOT enlarged to 1600
  });

  it('skips when the optimized output would be >= the original (keeps original, saves 0)', async () => {
    // A tiny, already-low-quality JPEG: re-encoding to high-quality WebP grows it.
    const tinyRaw = await noisePng(48, 48);
    const tinyLowQ = await sharp(tinyRaw).jpeg({ quality: 10 }).toBuffer();
    const res = await svc.process(tinyLowQ, {
      webpEnabled: true,
      quality: 90,
      maxWidth: null,
    });
    expect(res.outcome).toBe('skipped');
    expect(res.skipReason).toBe('output_larger');
    expect(res.optimizedBytes).toBe(res.originalBytes); // savings = 0
    expect(res.buffer).toBeUndefined();
  });

  it('skips SVG input', async () => {
    const svg = Buffer.from(
      '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10" fill="red"/></svg>',
    );
    const res = await svc.process(svg, {
      webpEnabled: true,
      quality: 80,
      maxWidth: 1600,
    });
    expect(res.outcome).toBe('skipped');
    expect(res.skipReason).toBe('svg');
    expect(res.optimizedBytes).toBe(res.originalBytes);
  });
});
