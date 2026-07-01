import { ImageOptimizationState } from './image-optimization.entity';
import { isStale } from './optimization-fingerprint';

/**
 * Pure stats aggregation — the SINGLE source of truth for bytesSaved / %saved.
 * Every screen and (later) MCP tool derives its numbers from HERE so nothing
 * recomputes them inconsistently (analyst: definitions live in one place).
 *
 * Honesty rules baked in:
 *   - % saved is WEIGHTED BY BYTES: SUM(saved) / SUM(originalBytes of the
 *     savings set) — NEVER an average of per-image percentages (analyst P0-4).
 *   - The savings set = OPTIMIZED rows only. `skipped` (kept original) saved 0
 *     and is reported separately; it never inflates or deflates the %.
 *   - `failed` rows contribute nothing (unknown, not zero).
 *   - Per-image saving is clamped at >= 0.
 */

export interface OptimizationRowLike {
  state: ImageOptimizationState;
  originalBytes: number | null;
  optimizedBytes: number | null;
  settingsFingerprint: string | null;
  optimizedAt?: Date | null;
}

export interface OptimizationStatsSummary {
  inventoryTotal: number;
  optimizedCount: number;
  skippedCount: number;
  failedCount: number;
  notOptimizedCount: number;
  staleCount: number;
  /** SUM(originalBytes) over the savings (optimized) set — the % denominator. */
  originalBytesOptimized: number;
  /** SUM(optimizedBytes) over the savings set. */
  optimizedBytes: number;
  /** SUM(max(0, original - optimized)) over the savings set. */
  bytesSaved: number;
  /** bytesSaved / originalBytesOptimized, 0..100, 0 when denominator is 0. */
  percentSaved: number;
  /** Latest optimizedAt across the set (freshness "as of"). */
  asOf: string | null;
}

export function aggregateStats(
  rows: OptimizationRowLike[],
  currentFingerprint: string,
  inventoryTotal: number,
): OptimizationStatsSummary {
  let optimizedCount = 0;
  let skippedCount = 0;
  let failedCount = 0;
  let staleCount = 0;
  let originalBytesOptimized = 0;
  let optimizedBytes = 0;
  let bytesSaved = 0;
  let latest: number | null = null;

  for (const r of rows) {
    switch (r.state) {
      case ImageOptimizationState.OPTIMIZED: {
        optimizedCount++;
        const orig = r.originalBytes ?? 0;
        const opt = r.optimizedBytes ?? 0;
        originalBytesOptimized += orig;
        optimizedBytes += opt;
        bytesSaved += Math.max(0, orig - opt); // clamp: never negative
        if (r.optimizedAt) {
          const t = new Date(r.optimizedAt).getTime();
          if (latest === null || t > latest) latest = t;
        }
        break;
      }
      case ImageOptimizationState.SKIPPED:
        skippedCount++;
        break;
      case ImageOptimizationState.FAILED:
        failedCount++;
        break;
      default:
        break; // not_optimized / queued / optimizing → counted via notOptimizedCount below
    }
    if (isStale(r, currentFingerprint)) staleCount++;
  }

  const terminalCounted = optimizedCount + skippedCount + failedCount;
  const notOptimizedCount = Math.max(0, inventoryTotal - terminalCounted);

  const percentSaved =
    originalBytesOptimized > 0
      ? Math.round((bytesSaved / originalBytesOptimized) * 1000) / 10
      : 0;

  return {
    inventoryTotal,
    optimizedCount,
    skippedCount,
    failedCount,
    notOptimizedCount,
    staleCount,
    originalBytesOptimized,
    optimizedBytes,
    bytesSaved,
    percentSaved,
    asOf: latest === null ? null : new Date(latest).toISOString(),
  };
}
