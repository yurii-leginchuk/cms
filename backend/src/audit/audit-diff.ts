/**
 * Pure, deterministic run-to-run diff — NO I/O (clones the `redirect-diff.ts`
 * discipline). Produces the Monday-morning hero buckets: new / persisting /
 * resolved / unconfirmed.
 *
 * THE anti-flapping rule (the data-analyst advisory's #1 trap, deliberately
 * NOT the redirect-audit auto-resolve): a previously-open finding may be
 * bucketed `resolved` ONLY when its detector pass this run was scope-complete
 * AND the finding's subject was actually re-evaluated AND the condition is
 * gone (`verified_absent`). A subject the run never re-checked (budget cut,
 * fetch error, missing rawHtml) stays open and is surfaced as `unconfirmed` —
 * "we didn't look" must never masquerade as "it's fixed".
 */

export interface DiffPrevFinding {
  fingerprint: string;
  checkType: string;
  subjectKey: string;
  /** Only open/muted/accepted rows participate (resolved ones are history). */
  status: 'open' | 'muted' | 'accepted';
}

export interface DiffCurrentFinding {
  fingerprint: string;
  checkType: string;
  subjectKey: string;
}

export interface DetectorPass {
  scopeComplete: boolean;
  evaluatedSubjects: Set<string>;
}

export interface AuditDiff {
  /** Fingerprints detected this run that were not previously active. */
  new: string[];
  /** Fingerprints detected this run that were already active. */
  persisting: string[];
  /** Previously-active fingerprints VERIFIED absent this run. */
  resolved: string[];
  /** Previously-active fingerprints whose subject was NOT re-evaluated. */
  unconfirmed: string[];
}

export function diffFindings(
  previous: DiffPrevFinding[],
  current: DiffCurrentFinding[],
  passes: Record<string, DetectorPass>,
): AuditDiff {
  const prevByFp = new Map(previous.map((p) => [p.fingerprint, p]));
  const currFps = new Set(current.map((c) => c.fingerprint));

  const out: AuditDiff = { new: [], persisting: [], resolved: [], unconfirmed: [] };

  const seen = new Set<string>();
  for (const c of current) {
    if (seen.has(c.fingerprint)) continue;
    seen.add(c.fingerprint);
    if (prevByFp.has(c.fingerprint)) out.persisting.push(c.fingerprint);
    else out.new.push(c.fingerprint);
  }

  for (const p of previous) {
    if (currFps.has(p.fingerprint)) continue;
    const pass = passes[p.checkType];
    const verifiedAbsent =
      pass != null && pass.scopeComplete && pass.evaluatedSubjects.has(p.subjectKey);
    if (verifiedAbsent) out.resolved.push(p.fingerprint);
    else out.unconfirmed.push(p.fingerprint);
  }

  // Stable order — the same inputs always produce byte-identical output.
  out.new.sort();
  out.persisting.sort();
  out.resolved.sort();
  out.unconfirmed.sort();
  return out;
}
