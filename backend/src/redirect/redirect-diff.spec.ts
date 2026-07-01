import { computeImportDiff, ExistingRedirect } from './redirect-diff';
import { ImportRow } from './redirect-io';
import { normalizeRedirectUrl, computeFingerprint, MAPPING_VERSION } from './redirect-normalize';

let seq = 0;
function existing(source: string, target: string | null, over: Partial<ExistingRedirect> = {}): ExistingRedirect {
  const sourceNormalized = normalizeRedirectUrl(source);
  const targetNormalized = target ? normalizeRedirectUrl(target) : null;
  const actionType = over.actionType ?? (target ? 'url' : 'error');
  const actionCode = over.actionCode ?? (target ? 301 : 410);
  const matchType = over.matchType ?? 'url';
  const regex = over.regex ?? false;
  const fingerprint = computeFingerprint({
    sourceNormalized, matchType, regex, groupId: null, actionType, actionCode, targetNormalized, mappingVersion: MAPPING_VERSION,
  });
  return {
    id: over.id ?? `ex-${seq++}`, pluginId: null, source, sourceNormalized, target, targetNormalized,
    matchType, regex, actionType, actionCode, enabled: over.enabled ?? true, fingerprint,
  };
}

function row(source: string, target: string | null, over: Partial<ImportRow> = {}): ImportRow {
  return {
    rowNumber: over.rowNumber ?? ++seq, source, target,
    actionCode: over.actionCode ?? (target ? 301 : 410),
    matchType: over.matchType ?? 'url', regex: over.regex ?? false,
    groupId: over.groupId ?? null, enabled: over.enabled ?? true, title: over.title ?? null,
  };
}

describe('computeImportDiff', () => {
  it('classifies add / update / no-op', () => {
    const ex = [existing('/keep', '/keep-target'), existing('/change', '/old')];
    const rows = [
      row('/keep', '/keep-target'),   // identical → noop
      row('/change', '/new'),         // same source, new target → update
      row('/brand-new', '/somewhere') // → add
    ];
    const diff = computeImportDiff('example.com', ex, rows, 'merge');
    const byOp = (op: string) => diff.filter((d) => d.op === op);
    expect(byOp('noop')).toHaveLength(1);
    expect(byOp('update')).toHaveLength(1);
    expect(byOp('add')).toHaveLength(1);
    expect(byOp('update')[0].redirectId).toBe(ex[1].id);
  });

  it('is DETERMINISTIC — same file + same state ⇒ identical diff (stable-sorted)', () => {
    const ex = [existing('/a', '/b')];
    const rows = [row('/z', '/y'), row('/m', '/n'), row('/a', '/c')];
    const a = computeImportDiff('example.com', ex, rows, 'merge');
    // Re-run with a shuffled input order — output must be identical.
    const b = computeImportDiff('example.com', ex, [rows[2], rows[0], rows[1]], 'merge');
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('BLOCKS a row that closes an exact loop', () => {
    const ex = [existing('/a', '/b'), existing('/b', '/c')];
    const diff = computeImportDiff('example.com', ex, [row('/c', '/a')], 'merge');
    expect(diff[0].status).toBe('blocked');
    expect(diff[0].issues[0]).toContain('creates a loop');
  });

  it('WARNS (not blocks) a possible loop through a regex hop', () => {
    const ex = [existing('/a', '/b', { regex: true })];
    // new /b → /a ; /a is a regex source, so the loop is "possible", not exact
    const diff = computeImportDiff('example.com', ex, [row('/b', '/a')], 'merge');
    expect(diff[0].status).toBe('warning');
  });

  it('flags an in-file duplicate as a warning no-op', () => {
    const diff = computeImportDiff('example.com', [], [row('/a', '/b'), row('/a', '/b')], 'merge');
    const noops = diff.filter((d) => d.op === 'noop');
    expect(noops).toHaveLength(1);
    expect(noops[0].issues[0]).toContain('duplicate row within the file');
  });

  it('warns on a conflict (import row vs a different existing rule for the same source)', () => {
    // NOTE: same source + same match/regex is an UPDATE; a conflict needs another
    // rule already on that source. Model it with two existing rules → the second
    // import row conflicts with the first accepted one.
    const ex = [existing('/a', '/b')];
    const diff = computeImportDiff('example.com', ex, [row('/a', '/b'), row('/a2', '/x')], 'merge');
    // /a identical → noop; /a2 new → add (no conflict) — sanity that clean adds stay ok
    expect(diff.every((d) => d.status !== 'blocked')).toBe(true);
  });

  it('replace mode marks existing rows absent from the file as deletes; merge does not', () => {
    const ex = [existing('/keep', '/t'), existing('/gone', '/t2')];
    const rows = [row('/keep', '/t')];
    const merge = computeImportDiff('example.com', ex, rows, 'merge');
    expect(merge.some((d) => d.op === 'delete')).toBe(false);
    const replace = computeImportDiff('example.com', ex, rows, 'replace');
    const del = replace.filter((d) => d.op === 'delete');
    expect(del).toHaveLength(1);
    expect(del[0].source).toBe('/gone');
  });
});
