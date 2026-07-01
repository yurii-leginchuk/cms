import { MAPPING_VERSION, normalizeRedirectUrl } from './redirect-normalize';
import { GraphRedirect, edgeClosesCycle } from './redirect-graph';
import { ImportRow, importRowFingerprint } from './redirect-io';

/**
 * Pure, deterministic import diff — NO I/O. Given the site's existing redirects and
 * a parsed import set, produce the add/update/delete/no-op plan, reusing the
 * Phase-1 fingerprint (identity) and the Phase-3 cycle check (blocking). The output
 * is stable-sorted by fingerprint, so the SAME file against the SAME current state
 * yields byte-identical results every run (spec'd).
 */

export type ImportMode = 'merge' | 'replace';
export type DiffOp = 'add' | 'update' | 'delete' | 'noop';
export type DiffStatus = 'ok' | 'warning' | 'blocked';

export interface DiffRow {
  op: DiffOp;
  status: DiffStatus;
  rowNumber: number | null;
  fingerprint: string;
  source: string;
  target: string | null;
  actionCode: number;
  matchType: string;
  regex: boolean;
  enabled: boolean;
  redirectId: string | null;
  issues: string[];
}

/** Existing redirect as a graph node PLUS its content fingerprint. */
export interface ExistingRedirect extends GraphRedirect {
  fingerprint: string;
}

function sourceKey(sourceNormalized: string, matchType: string | null, regex: boolean): string {
  return `${sourceNormalized} ${matchType ?? 'url'} ${regex ? 1 : 0}`;
}

export function computeImportDiff(
  siteHost: string | null,
  existing: ExistingRedirect[],
  rows: ImportRow[],
  mode: ImportMode,
): DiffRow[] {
  const byFingerprint = new Map<string, ExistingRedirect>();
  const bySourceKey = new Map<string, ExistingRedirect>();
  for (const e of existing) {
    byFingerprint.set(e.fingerprint, e);
    bySourceKey.set(sourceKey(e.sourceNormalized, e.matchType, e.regex), e);
  }

  // Accepted graph (existing + accepted import edges) for within-file cycle detection.
  const accepted: GraphRedirect[] = existing.map((e) => ({ ...e }));
  const seenInFile = new Set<string>();
  const importedFingerprints = new Set<string>();
  const importedSourceKeys = new Set<string>();
  const out: DiffRow[] = [];

  for (const row of rows) {
    const fp = importRowFingerprint(row, MAPPING_VERSION);
    const srcN = normalizeRedirectUrl(row.source);
    const tgtN = row.target ? normalizeRedirectUrl(row.target) : null;
    const srcKey = sourceKey(srcN, row.matchType, row.regex);
    importedFingerprints.add(fp);
    importedSourceKeys.add(srcKey);

    const base: DiffRow = {
      op: 'add', status: 'ok', rowNumber: row.rowNumber, fingerprint: fp,
      source: row.source, target: row.target, actionCode: row.actionCode,
      matchType: row.matchType, regex: row.regex, enabled: row.enabled,
      redirectId: null, issues: [],
    };

    if (seenInFile.has(fp)) {
      out.push({ ...base, op: 'noop', status: 'warning', issues: ['duplicate row within the file'] });
      continue;
    }
    seenInFile.add(fp);

    if (byFingerprint.has(fp)) {
      out.push({ ...base, op: 'noop', redirectId: byFingerprint.get(fp)!.id });
      continue;
    }

    const sameSourceItem = bySourceKey.get(srcKey);
    const op: DiffOp = sameSourceItem ? 'update' : 'add';
    const redirectId = sameSourceItem?.id ?? null;

    const issues: string[] = [];
    let status: DiffStatus = 'ok';

    const conflict = accepted.find((g) =>
      g.id !== redirectId &&
      g.sourceNormalized === srcN && (g.matchType ?? 'url') === row.matchType &&
      ((g.targetNormalized ?? '') !== (tgtN ?? '') || g.actionCode !== row.actionCode));
    if (conflict) { issues.push(`conflicts with an existing rule for ${row.source}`); status = 'warning'; }

    const forCheck = op === 'update' && redirectId ? accepted.filter((g) => g.id !== redirectId) : accepted;
    const cycle = edgeClosesCycle(forCheck, {
      sourceNormalized: srcN, targetNormalized: tgtN, regex: row.regex,
      actionType: row.target ? 'url' : 'error', actionCode: row.actionCode,
    }, siteHost);
    if (cycle.closesCycle) {
      if (cycle.certainty === 'exact') {
        issues.push(`creates a loop: ${(cycle.path ?? []).join(' → ')}`);
        status = 'blocked';
      } else {
        issues.push(`might create a loop through a regex/external hop: ${(cycle.path ?? []).join(' → ')}`);
        status = 'warning';
      }
    }

    out.push({ ...base, op, status, redirectId, issues });

    if (status !== 'blocked') {
      const node = toGraphFromRow(redirectId ?? `import:${row.rowNumber}`, srcN, tgtN, row);
      if (op === 'update' && redirectId) {
        const idx = accepted.findIndex((g) => g.id === redirectId);
        if (idx >= 0) accepted[idx] = node; else accepted.push(node);
      } else {
        accepted.push(node);
      }
    }
  }

  if (mode === 'replace') {
    for (const e of existing) {
      if (importedFingerprints.has(e.fingerprint)) continue;
      if (importedSourceKeys.has(sourceKey(e.sourceNormalized, e.matchType, e.regex))) continue;
      out.push({
        op: 'delete', status: 'ok', rowNumber: null, fingerprint: e.fingerprint,
        source: e.source, target: e.target, actionCode: e.actionCode ?? 301,
        matchType: e.matchType ?? 'url', regex: e.regex, enabled: e.enabled,
        redirectId: e.id, issues: ['not present in the imported file (replace mode)'],
      });
    }
  }

  return out.sort((a, b) => (a.fingerprint < b.fingerprint ? -1 : a.fingerprint > b.fingerprint ? 1 : 0));
}

function toGraphFromRow(id: string, srcN: string, tgtN: string | null, row: ImportRow): GraphRedirect {
  return {
    id, pluginId: null, source: row.source, sourceNormalized: srcN,
    target: row.target, targetNormalized: tgtN, matchType: row.matchType,
    regex: row.regex, actionType: row.target ? 'url' : 'error', actionCode: row.actionCode, enabled: row.enabled,
  };
}
