import {
  computeSettingsFingerprint,
  isUpToDate,
  isStale,
  shouldProcess,
} from './optimization-fingerprint';
import { aggregateStats, OptimizationRowLike } from './optimization-stats';
import { ImageOptimizationState } from './image-optimization.entity';
import { OptimizationRunScope } from './image-optimization-run.entity';

const S = ImageOptimizationState;

describe('computeSettingsFingerprint', () => {
  const base = { quality: 80, webpEnabled: true, maxWidth: 1600, encoderVersion: '8.15.0' };

  it('is deterministic for identical settings', () => {
    expect(computeSettingsFingerprint(base)).toBe(computeSettingsFingerprint(base));
  });

  it('changes when quality, webp, maxWidth, or encoder version change', () => {
    const fp = computeSettingsFingerprint(base);
    expect(computeSettingsFingerprint({ ...base, quality: 70 })).not.toBe(fp);
    expect(computeSettingsFingerprint({ ...base, webpEnabled: false })).not.toBe(fp);
    expect(computeSettingsFingerprint({ ...base, maxWidth: 2000 })).not.toBe(fp);
    expect(computeSettingsFingerprint({ ...base, encoderVersion: '8.16.0' })).not.toBe(fp);
  });
});

describe('isUpToDate / isStale', () => {
  it('optimized under the current fingerprint is up-to-date and not stale', () => {
    const row = { state: S.OPTIMIZED, settingsFingerprint: 'fpA' };
    expect(isUpToDate(row, 'fpA')).toBe(true);
    expect(isStale(row, 'fpA')).toBe(false);
  });
  it('optimized under a DIFFERENT fingerprint is stale, not up-to-date', () => {
    const row = { state: S.OPTIMIZED, settingsFingerprint: 'fpOld' };
    expect(isUpToDate(row, 'fpNew')).toBe(false);
    expect(isStale(row, 'fpNew')).toBe(true);
  });
  it('failed / not_optimized are neither up-to-date nor stale', () => {
    expect(isUpToDate({ state: S.FAILED, settingsFingerprint: 'fpA' }, 'fpA')).toBe(false);
    expect(isStale({ state: S.NOT_OPTIMIZED, settingsFingerprint: null }, 'fpA')).toBe(false);
  });
  it('null existing is not up-to-date', () => {
    expect(isUpToDate(null, 'fpA')).toBe(false);
  });
});

describe('shouldProcess', () => {
  const fp = 'fpCurrent';
  const optimizedCurrent = { state: S.OPTIMIZED, settingsFingerprint: fp };
  const optimizedStale = { state: S.OPTIMIZED, settingsFingerprint: 'fpOld' };
  const failed = { state: S.FAILED, settingsFingerprint: fp };

  it('force_all processes everything, even up-to-date', () => {
    expect(shouldProcess(OptimizationRunScope.FORCE_ALL, optimizedCurrent, fp)).toBe(true);
    expect(shouldProcess(OptimizationRunScope.FORCE_ALL, null, fp)).toBe(true);
  });

  it('new_only processes only never-succeeded images', () => {
    expect(shouldProcess(OptimizationRunScope.NEW_ONLY, null, fp)).toBe(true);
    expect(shouldProcess(OptimizationRunScope.NEW_ONLY, failed, fp)).toBe(true);
    expect(shouldProcess(OptimizationRunScope.NEW_ONLY, optimizedCurrent, fp)).toBe(false);
    expect(shouldProcess(OptimizationRunScope.NEW_ONLY, optimizedStale, fp)).toBe(false);
  });

  it('all re-does stale + failed + new, skips up-to-date', () => {
    expect(shouldProcess(OptimizationRunScope.ALL, null, fp)).toBe(true);
    expect(shouldProcess(OptimizationRunScope.ALL, failed, fp)).toBe(true);
    expect(shouldProcess(OptimizationRunScope.ALL, optimizedStale, fp)).toBe(true);
    expect(shouldProcess(OptimizationRunScope.ALL, optimizedCurrent, fp)).toBe(false);
  });
});

describe('aggregateStats (honest savings)', () => {
  const fp = 'fpCurrent';

  it('weights % by bytes (never averages per-image %) and excludes skipped/failed from savings', () => {
    const rows: OptimizationRowLike[] = [
      // 60% saved on a small file
      { state: S.OPTIMIZED, originalBytes: 1000, optimizedBytes: 400, settingsFingerprint: fp },
      // 50% saved on a big file
      { state: S.OPTIMIZED, originalBytes: 2000, optimizedBytes: 1000, settingsFingerprint: fp },
      // skipped: kept original, saves nothing, must NOT enter the denominator
      { state: S.SKIPPED, originalBytes: 500, optimizedBytes: 500, settingsFingerprint: fp },
      // failed: unknown, contributes nothing
      { state: S.FAILED, originalBytes: null, optimizedBytes: null, settingsFingerprint: fp },
      // never optimized
      { state: S.NOT_OPTIMIZED, originalBytes: null, optimizedBytes: null, settingsFingerprint: null },
    ];
    const s = aggregateStats(rows, fp, 5);

    expect(s.optimizedCount).toBe(2);
    expect(s.skippedCount).toBe(1);
    expect(s.failedCount).toBe(1);
    expect(s.notOptimizedCount).toBe(1);
    expect(s.bytesSaved).toBe(1600); // 600 + 1000
    expect(s.originalBytesOptimized).toBe(3000); // 1000 + 2000 (skipped's 500 excluded)
    // Weighted: 1600/3000 = 53.3%, NOT the (60+50)/2 = 55% average.
    expect(s.percentSaved).toBe(53.3);
  });

  it('clamps negative per-image savings to zero and reports 0% with no optimized rows', () => {
    const rows: OptimizationRowLike[] = [
      { state: S.OPTIMIZED, originalBytes: 100, optimizedBytes: 120, settingsFingerprint: fp }, // pathological
    ];
    const s = aggregateStats(rows, fp, 1);
    expect(s.bytesSaved).toBe(0); // clamped, not -20

    const empty = aggregateStats([], fp, 0);
    expect(empty.percentSaved).toBe(0);
    expect(empty.bytesSaved).toBe(0);
  });

  it('counts stale rows (optimized under an old fingerprint) as derived stale', () => {
    const rows: OptimizationRowLike[] = [
      { state: S.OPTIMIZED, originalBytes: 1000, optimizedBytes: 500, settingsFingerprint: 'fpOld' },
      { state: S.OPTIMIZED, originalBytes: 1000, optimizedBytes: 500, settingsFingerprint: fp },
    ];
    const s = aggregateStats(rows, fp, 2);
    expect(s.staleCount).toBe(1);
  });
});
