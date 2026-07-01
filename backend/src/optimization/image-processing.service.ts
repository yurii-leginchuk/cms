import { Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { ImageSkipReason } from './image-optimization.entity';

// sharp 0.35's types declare an ESM default export, but the CJS `require` returns
// the callable factory directly (no `.default`). Bind via require + a factory
// cast so this works under our commonjs build without flipping esModuleInterop.
// eslint-disable-next-line @typescript-eslint/no-require-imports
const sharp = require('sharp') as typeof import('sharp').default;

/**
 * Pure-ish wrapper over `sharp` (0.35.x). NO database, NO network — takes bytes
 * in, returns an optimization decision + optimized bytes out, so it is fully
 * unit-testable with fixture buffers.
 *
 * Pipeline (ResearchPack §2.4):
 *   metadata() → skip if animated (pages>1) or SVG
 *   → resize({ width: maxWidth, withoutEnlargement: true })  // only downscales wider images
 *   → webp({ quality, effort:6, smartSubsample:true })  OR  jpeg({ mozjpeg:true, quality })
 *   → if output >= original, KEEP ORIGINAL (skip: output_larger)  // honest savings (analyst P0-4)
 */

export interface ProcessOptions {
  webpEnabled: boolean;
  quality: number;
  /** null = no resize. */
  maxWidth: number | null;
}

export interface ProcessResult {
  outcome: 'optimized' | 'skipped';
  skipReason?: ImageSkipReason;
  format?: 'webp' | 'jpeg';
  width?: number;
  height?: number;
  originalBytes: number;
  /** Equals originalBytes for every skip outcome (savings = 0). */
  optimizedBytes: number;
  /** Present only when outcome === 'optimized' (Phase 2 uploads this to R2). */
  buffer?: Buffer;
}

/** Minimal metadata shape we branch on — kept tiny so tests can pass plain objects. */
export interface SkipMetadata {
  format?: string;
  pages?: number;
}

/**
 * Decide whether an image must be skipped based on its metadata alone.
 * Exported and pure so the animated/SVG rules are unit-tested without needing a
 * real multi-frame fixture. Returns null when the image is processable.
 */
export function classifySkip(meta: SkipMetadata): ImageSkipReason | null {
  if (meta.format === 'svg') return 'svg';
  if (typeof meta.pages === 'number' && meta.pages > 1) return 'animated';
  return null;
}

/** sha256 hex of the exact source bytes — the content-identity / dedup signal. */
export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

@Injectable()
export class ImageProcessingService {
  /** libvips version — part of the settings fingerprint so an encoder upgrade is explainable. */
  encoderVersion(): string {
    return sharp.versions?.vips ?? 'unknown';
  }

  async process(input: Buffer, opts: ProcessOptions): Promise<ProcessResult> {
    const originalBytes = input.length;

    const meta = await sharp(input).metadata();
    const skip = classifySkip({ format: meta.format, pages: meta.pages });
    if (skip) {
      return { outcome: 'skipped', skipReason: skip, originalBytes, optimizedBytes: originalBytes };
    }

    let pipeline = sharp(input, { failOn: 'none' });
    if (opts.maxWidth) {
      // withoutEnlargement: only images WIDER than maxWidth are downscaled;
      // narrower ones are left untouched (ResearchPack §1b).
      pipeline = pipeline.resize({ width: opts.maxWidth, withoutEnlargement: true });
    }
    pipeline = opts.webpEnabled
      ? pipeline.webp({ quality: opts.quality, effort: 6, smartSubsample: true })
      : pipeline.jpeg({ mozjpeg: true, quality: opts.quality });

    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });

    // Never let optimization make a file bigger — keep the original, save nothing.
    if (info.size >= originalBytes) {
      return {
        outcome: 'skipped',
        skipReason: 'output_larger',
        originalBytes,
        optimizedBytes: originalBytes,
      };
    }

    return {
      outcome: 'optimized',
      format: opts.webpEnabled ? 'webp' : 'jpeg',
      width: info.width,
      height: info.height,
      originalBytes,
      optimizedBytes: info.size,
      buffer: data,
    };
  }
}
