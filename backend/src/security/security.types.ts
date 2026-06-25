/**
 * Shared types for the Security / cloaking-detection module (Phase 1).
 *
 * Detectors are pure functions that emit DetectorSignal[]; the severity rubric
 * turns those signals into a deterministic score + severity. Persisted on the
 * immutable finding so a score is always explainable from its inputs.
 */

export type SecurityAxis = 'googlebot' | 'chrome';

export type SecuritySeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type SecurityDetector =
  | 'redirect_cloak'
  | 'spam_lexicon'
  | 'injected_scripts'
  | 'content_diff'
  | 'unreachable';

export type AxisFetchStatus = 'reachable' | 'unreachable' | 'error';

export type IncidentScope = 'site' | 'page';

export type IncidentStatus =
  | 'open'
  | 'confirmed'
  | 'snoozed'
  | 'dismissed'
  | 'false_positive'
  | 'resolved';

export type ScanRunStatus = 'running' | 'completed' | 'partial' | 'failed';

/** A single piece of evidence emitted by a detector. */
export interface DetectorSignal {
  detector: SecurityDetector;
  /** Machine code, e.g. 'bot_only_external_redirect', 'spam_term'. */
  code: string;
  /** Counts toward severity escalation (≥2 independent malicious ⇒ high/critical). */
  malicious: boolean;
  /** Contribution to the additive score. */
  weight: number;
  /** Human-readable, surfaced verbatim in the UI. */
  message: string;
  /** Verbatim matched data (terms, domains, urls) — never paraphrased. */
  evidence: Record<string, unknown>;
}

/** Active incident states (suppression / new-incident logic keys off these). */
export const ACTIVE_INCIDENT_STATUSES: IncidentStatus[] = ['open', 'confirmed', 'snoozed'];
