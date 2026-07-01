import { createHash } from 'crypto';
import {
  ImageOptimizationState,
  ImageOptimization,
} from './image-optimization.entity';
import { OptimizationRunScope } from './image-optimization-run.entity';

/**
 * Pure idempotency logic — the single source of truth for "does this image need
 * (re)processing?" and "what settings was it optimized under?". No I/O, so it is
 * exhaustively unit-tested.
 */

export interface FingerprintInput {
  quality: number;
  webpEnabled: boolean;
  maxWidth: number | null;
  encoderVersion: string;
}

/**
 * Deterministic short hash of the optimization-affecting settings PLUS the
 * encoder version. Two images share a fingerprint iff they'd be optimized
 * identically — the provable "already optimized under current settings" signal
 * (analyst P1-1). Including the encoder version means a sharp/libvips upgrade
 * legitimately invalidates prior output and is explainable.
 */
export function computeSettingsFingerprint(input: FingerprintInput): string {
  const canonical = JSON.stringify({
    q: input.quality,
    webp: input.webpEnabled,
    w: input.maxWidth ?? null,
    enc: input.encoderVersion,
  });
  return createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

/** An image is "up to date" iff it reached a terminal success under the current fingerprint. */
export function isUpToDate(
  existing: Pick<ImageOptimization, 'state' | 'settingsFingerprint'> | null,
  currentFingerprint: string,
): boolean {
  if (!existing) return false;
  const terminalSuccess =
    existing.state === ImageOptimizationState.OPTIMIZED ||
    existing.state === ImageOptimizationState.SKIPPED;
  return terminalSuccess && existing.settingsFingerprint === currentFingerprint;
}

/**
 * Should this image be processed by a run of the given scope?
 *   - force_all : always (ignores fingerprint) — the "reprocess everything" path.
 *   - all       : everything not already up-to-date (re-does stale + failed + new).
 *   - new_only  : only images never successfully optimized (new / not_optimized / failed).
 */
export function shouldProcess(
  scope: OptimizationRunScope,
  existing: Pick<ImageOptimization, 'state' | 'settingsFingerprint'> | null,
  currentFingerprint: string,
): boolean {
  if (scope === OptimizationRunScope.FORCE_ALL) return true;

  if (scope === OptimizationRunScope.NEW_ONLY) {
    return (
      !existing ||
      existing.state === ImageOptimizationState.NOT_OPTIMIZED ||
      existing.state === ImageOptimizationState.FAILED
    );
  }

  // scope === ALL
  return !isUpToDate(existing, currentFingerprint);
}

/** Derived stale flag: previously optimized/skipped, but under a different fingerprint. */
export function isStale(
  row: Pick<ImageOptimization, 'state' | 'settingsFingerprint'>,
  currentFingerprint: string,
): boolean {
  const terminalSuccess =
    row.state === ImageOptimizationState.OPTIMIZED ||
    row.state === ImageOptimizationState.SKIPPED;
  return terminalSuccess && row.settingsFingerprint !== currentFingerprint;
}
