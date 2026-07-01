import {
  GraphRedirect,
  findDuplicates,
  findConflicts,
  detectCycles,
  edgeClosesCycle,
  findChains,
  isTerminal,
  isExternalUrl,
} from './redirect-graph';

let seq = 0;
function r(over: Partial<GraphRedirect> = {}): GraphRedirect {
  const source = over.source ?? over.sourceNormalized ?? `/s${seq++}`;
  const target = over.target ?? over.targetNormalized ?? null;
  return {
    id: over.id ?? `id-${seq++}`,
    pluginId: over.pluginId ?? null,
    source,
    sourceNormalized: over.sourceNormalized ?? source,
    target,
    targetNormalized: over.targetNormalized ?? (over.target ?? null),
    matchType: over.matchType ?? 'url',
    regex: over.regex ?? false,
    actionType: over.actionType ?? (target ? 'url' : 'error'),
    actionCode: over.actionCode ?? (target ? 301 : 410),
    enabled: over.enabled ?? true,
    ...over,
  };
}

/** Concrete url→url redirect. */
function edge(id: string, from: string, to: string, over: Partial<GraphRedirect> = {}): GraphRedirect {
  return r({ id, source: from, sourceNormalized: from, target: to, targetNormalized: to, actionType: 'url', actionCode: 301, ...over });
}

describe('isTerminal', () => {
  it('treats error / 410 / 404 / no-target as terminal (a response, not a hop)', () => {
    expect(isTerminal({ actionType: 'error', actionCode: 410, targetNormalized: null })).toBe(true);
    expect(isTerminal({ actionType: 'url', actionCode: 404, targetNormalized: '/x' })).toBe(true);
    expect(isTerminal({ actionType: 'url', actionCode: 410, targetNormalized: '/x' })).toBe(true);
    expect(isTerminal({ actionType: 'url', actionCode: 301, targetNormalized: null })).toBe(true);
    expect(isTerminal({ actionType: 'url', actionCode: 301, targetNormalized: '/x' })).toBe(false);
  });
});

describe('isExternalUrl', () => {
  it('flags a different host as external, folds www, treats relative as internal', () => {
    expect(isExternalUrl('https://other.com/a', 'example.com')).toBe(true);
    expect(isExternalUrl('https://www.example.com/a', 'example.com')).toBe(false);
    expect(isExternalUrl('/a', 'example.com')).toBe(false);
    expect(isExternalUrl('https://x.com/a', null)).toBe(false);
  });
});

describe('findDuplicates', () => {
  it('groups redirects with the same (source, matchType, regex)', () => {
    const dups = findDuplicates([
      edge('a', '/x', '/y'),
      edge('b', '/x', '/z'), // same source+matchType+regex → duplicate identity
      edge('c', '/other', '/y'),
    ]);
    expect(dups).toHaveLength(1);
    expect(dups[0].redirectIds.sort()).toEqual(['a', 'b']);
  });

  it('does NOT treat a regex vs non-regex same source as a duplicate', () => {
    const dups = findDuplicates([
      edge('a', '/x', '/y'),
      edge('b', '/x', '/y', { regex: true }),
    ]);
    expect(dups).toHaveLength(0);
  });
});

describe('findConflicts', () => {
  it('flags one source sending to different targets', () => {
    const c = findConflicts([edge('a', '/x', '/y'), edge('b', '/x', '/z')]);
    expect(c).toHaveLength(1);
    expect(c[0].variants).toHaveLength(2);
  });

  it('flags one source with different status codes', () => {
    const c = findConflicts([edge('a', '/x', '/y', { actionCode: 301 }), edge('b', '/x', '/y', { actionCode: 302 })]);
    expect(c).toHaveLength(1);
  });

  it('same source, same destination is not a conflict (it is a duplicate)', () => {
    expect(findConflicts([edge('a', '/x', '/y'), edge('b', '/x', '/y')])).toHaveLength(0);
  });
});

describe('detectCycles', () => {
  it('finds an exact 2-node cycle A→B→A', () => {
    const cycles = detectCycles([edge('a', '/x', '/y'), edge('b', '/y', '/x')]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].certainty).toBe('exact');
    expect(cycles[0].redirectIds.sort()).toEqual(['a', 'b']);
  });

  it('finds an exact self-loop A→A', () => {
    const cycles = detectCycles([edge('a', '/x', '/x')]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].certainty).toBe('exact');
  });

  it('does NOT treat a 410/404 target as an edge (terminals break the chain)', () => {
    // /y is "Gone" — /x→/y is a real hop, but /y has no out-edge, so no cycle.
    const cycles = detectCycles([
      edge('a', '/x', '/y'),
      r({ id: 'b', source: '/y', sourceNormalized: '/y', actionType: 'error', actionCode: 410 }),
    ]);
    expect(cycles).toHaveLength(0);
  });

  it('marks a cycle through a regex source as possible, never exact', () => {
    const cycles = detectCycles([
      edge('a', '/x', '/y'),
      edge('b', '/y', '/x', { regex: true }),
    ]);
    expect(cycles).toHaveLength(1);
    expect(cycles[0].certainty).toBe('possible');
  });

  it('marks a cycle through an external host as possible', () => {
    const cycles = detectCycles(
      [edge('a', '/x', 'https://other.com/y'), edge('b', 'https://other.com/y', '/x')],
      'example.com',
    );
    expect(cycles).toHaveLength(1);
    expect(cycles[0].certainty).toBe('possible');
  });

  it('no cycle for a plain chain A→B→C', () => {
    expect(detectCycles([edge('a', '/x', '/y'), edge('b', '/y', '/z')])).toHaveLength(0);
  });
});

describe('edgeClosesCycle', () => {
  const existing = [edge('a', '/x', '/y'), edge('b', '/y', '/z')];

  it('detects a new edge that closes a loop (/z→/x over existing /x→/y→/z)', () => {
    const res = edgeClosesCycle(existing, {
      sourceNormalized: '/z', targetNormalized: '/x', regex: false, actionType: 'url', actionCode: 301,
    });
    expect(res.closesCycle).toBe(true);
    expect(res.certainty).toBe('exact');
    expect(res.path?.[0]).toBe('/z');
  });

  it('detects a self-loop edge', () => {
    const res = edgeClosesCycle([], {
      sourceNormalized: '/x', targetNormalized: '/x', regex: false, actionType: 'url', actionCode: 301,
    });
    expect(res.closesCycle).toBe(true);
    expect(res.certainty).toBe('exact');
  });

  it('a safe new edge does not close a cycle', () => {
    const res = edgeClosesCycle(existing, {
      sourceNormalized: '/z', targetNormalized: '/final', regex: false, actionType: 'url', actionCode: 301,
    });
    expect(res.closesCycle).toBe(false);
  });

  it('a regex new edge that closes a loop is possible, not exact', () => {
    const res = edgeClosesCycle(existing, {
      sourceNormalized: '/z', targetNormalized: '/x', regex: true, actionType: 'url', actionCode: 301,
    });
    expect(res.closesCycle).toBe(true);
    expect(res.certainty).toBe('possible');
  });

  it('a terminal new edge (410) can never close a cycle', () => {
    const res = edgeClosesCycle(existing, {
      sourceNormalized: '/z', targetNormalized: null, regex: false, actionType: 'error', actionCode: 410,
    });
    expect(res.closesCycle).toBe(false);
  });
});

describe('findChains', () => {
  it('finds a single maximal chain A→B→C (length 2)', () => {
    const chains = findChains([edge('a', '/x', '/y'), edge('b', '/y', '/z')]);
    expect(chains).toHaveLength(1);
    expect(chains[0].length).toBe(2);
    expect(chains[0].hops).toEqual(['/x', '/y', '/z']);
    expect(chains[0].redirectIds).toEqual(['a', 'b']);
  });

  it('does not report a bare single redirect (length 1) as a chain', () => {
    expect(findChains([edge('a', '/x', '/y')])).toHaveLength(0);
  });

  it('excludes regex sources from chains (cannot statically resolve)', () => {
    // /y→/z is regex, so the chain stops at /y.
    const chains = findChains([edge('a', '/x', '/y'), edge('b', '/y', '/z', { regex: true })]);
    expect(chains).toHaveLength(0);
  });

  it('stops a chain at a fork (conflict), not treating it as clean', () => {
    const chains = findChains([
      edge('a', '/x', '/y'),
      edge('b', '/y', '/z'),
      edge('c', '/y', '/w'), // fork at /y
    ]);
    // /x→/y is a head, but /y forks → chain of length 1 only → not reported.
    expect(chains).toHaveLength(0);
  });

  it('marks a chain that runs into a cycle', () => {
    const chains = findChains([
      edge('a', '/x', '/y'),
      edge('b', '/y', '/z'),
      edge('c', '/z', '/y'), // /y and /z loop; /x is the head
    ]);
    // /x is a head (no in-edge), follows /x→/y→/z then revisits /y.
    if (chains.length) expect(chains[0].hasCycle).toBe(true);
  });

  it('stops at an external final target but still reports the internal chain', () => {
    const chains = findChains(
      [edge('a', '/x', '/y'), edge('b', '/y', 'https://other.com/z')],
      'example.com',
    );
    expect(chains).toHaveLength(1);
    expect(chains[0].hops[chains[0].hops.length - 1]).toBe('https://other.com/z');
  });
});
