/**
 * Deterministic, versioned severity rubric — the single source of truth for a
 * finding's score. Pure function mirroring schema-validator.ts; never an opaque
 * "magic number". Both the inputs (signals) and the output (score/severity) are
 * persisted on the immutable finding, so a verdict is always explainable and
 * recomputable if the rubric changes (bump RUBRIC_VERSION).
 *
 * Core anti-false-positive principle: a single axis difference is never high.
 * Severity escalates only when independent MALICIOUS signals co-occur.
 */

import { DetectorSignal, SecuritySeverity } from './security.types';

export const RUBRIC_VERSION = 1;

const CRITICAL_SCORE = 80;

export interface RubricResult {
  score: number;
  severity: SecuritySeverity;
  /** Distinct malicious signal codes that drove escalation. */
  maliciousCodes: string[];
}

export function scoreFindings(signals: DetectorSignal[]): RubricResult {
  const score = signals.reduce((sum, s) => sum + s.weight, 0);
  const maliciousCodes = [...new Set(signals.filter((s) => s.malicious).map((s) => s.code))];
  const maliciousCount = maliciousCodes.length;

  let severity: SecuritySeverity;
  if (signals.length === 0) {
    severity = 'info';
  } else if (maliciousCount === 0) {
    // Only benign signals (content mismatch, script drift) — informational.
    severity = score >= 10 ? 'low' : 'info';
  } else if (maliciousCount === 1) {
    severity = 'medium';
  } else {
    // ≥2 independent malicious signals co-occur.
    severity = score >= CRITICAL_SCORE || maliciousCount >= 3 ? 'critical' : 'high';
  }

  return { score, severity, maliciousCodes };
}

const ORDER: SecuritySeverity[] = ['info', 'low', 'medium', 'high', 'critical'];

/** Worst-dominant comparison (used for site health + incident severity rollup). */
export function maxSeverity(a: SecuritySeverity, b: SecuritySeverity): SecuritySeverity {
  return ORDER.indexOf(a) >= ORDER.indexOf(b) ? a : b;
}

export function severityRank(s: SecuritySeverity): number {
  return ORDER.indexOf(s);
}
