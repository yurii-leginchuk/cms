import { NotFoundException } from '@nestjs/common';
import { OptimizationEffectsService } from './optimization-effects.service';

/** Repo stubs whose methods ignore args and return the fixtures. */
function effectsRepo(effect: any) {
  return { findOne: jest.fn().mockResolvedValue(effect) } as any;
}
function queriesRepo(rows: any[]) {
  return { find: jest.fn().mockResolvedValue(rows) } as any;
}

const q = (
  window: 'baseline' | 'result',
  query: string,
  clicks: number,
  impressions: number,
  position: number,
  isRemainder = false,
) => ({ window, query, clicks, impressions, ctr: 0, position, isRemainder });

describe('OptimizationEffectsService.getEffectQueries', () => {
  function build(effect: any, rows: any[]) {
    return new OptimizationEffectsService(effectsRepo(effect), queriesRepo(rows), {} as any);
  }

  const measuredEffect = {
    id: 'e1', siteId: 's1', status: 'measured', baselineClicks: 100, resultClicks: 200,
  };

  // alpha: in both windows (moved up). beta: baseline only → lost.
  // gamma: result only → new. remainder reconciles to the page total.
  const bothWindows = [
    q('baseline', 'alpha', 40, 1000, 8),
    q('baseline', 'beta', 20, 500, 12),
    q('baseline', '', 40, 2000, 0, true), // disclosed 60, total 100 → 0.6
    q('result', 'alpha', 120, 2000, 4),
    q('result', 'gamma', 50, 800, 6),
    q('result', '', 30, 1500, 0, true), // disclosed 170, total 200 → 0.85
  ];

  it('merges the two window snapshots by query', async () => {
    const res = await build(measuredEffect, bothWindows).getEffectQueries('s1', 'e1');
    const alpha = res.rows.find((r) => r.query === 'alpha')!;
    expect(alpha.baseline).toEqual({ clicks: 40, impressions: 1000, ctr: 0, position: 8 });
    expect(alpha.result).toEqual({ clicks: 120, impressions: 2000, ctr: 0, position: 4 });
  });

  it('reports disclosed-query coverage per window', async () => {
    const res = await build(measuredEffect, bothWindows).getEffectQueries('s1', 'e1');
    expect(res.baselineCoverage).toBeCloseTo(0.6, 4);
    expect(res.resultCoverage).toBeCloseTo(0.85, 4);
  });

  it('flags new and lost queries (only when the other window was snapshotted)', async () => {
    const res = await build(measuredEffect, bothWindows).getEffectQueries('s1', 'e1');
    const gamma = res.rows.find((r) => r.query === 'gamma')!;
    const beta = res.rows.find((r) => r.query === 'beta')!;
    const alpha = res.rows.find((r) => r.query === 'alpha')!;
    expect(gamma.isNew).toBe(true);
    expect(gamma.isLost).toBe(false);
    expect(beta.isLost).toBe(true);
    expect(beta.isNew).toBe(false);
    expect(alpha.isNew).toBe(false);
    expect(alpha.isLost).toBe(false);
  });

  it('sorts biggest movers first and keeps the remainder row last', async () => {
    const res = await build(measuredEffect, bothWindows).getEffectQueries('s1', 'e1');
    const realOrder = res.rows.filter((r) => !r.isRemainder).map((r) => r.query);
    expect(realOrder).toEqual(['alpha', 'gamma', 'beta']);
    expect(res.rows[res.rows.length - 1].isRemainder).toBe(true);
  });

  it('does NOT flag every result query as "new" for a legacy effect with no baseline snapshot', async () => {
    const resultOnly = [
      q('result', 'alpha', 120, 2000, 4),
      q('result', 'gamma', 50, 800, 6),
    ];
    const res = await build(measuredEffect, resultOnly).getEffectQueries('s1', 'e1');
    expect(res.rows.every((r) => !r.isNew)).toBe(true);
  });

  it('leaves result coverage null for an unmeasured (pending) effect', async () => {
    const pending = { id: 'e2', siteId: 's1', status: 'pending', baselineClicks: 100, resultClicks: null };
    const baselineOnly = [
      q('baseline', 'alpha', 40, 1000, 8),
      q('baseline', '', 60, 3000, 0, true),
    ];
    const res = await build(pending, baselineOnly).getEffectQueries('s1', 'e2');
    expect(res.measured).toBe(false);
    expect(res.resultCoverage).toBeNull();
    expect(res.baselineCoverage).toBeCloseTo(0.4, 4);
    // No result window yet → nothing can be "lost".
    expect(res.rows.every((r) => !r.isLost)).toBe(true);
  });

  it('returns null coverage when the page-total clicks are zero', async () => {
    const zero = { id: 'e3', siteId: 's1', status: 'measured', baselineClicks: 0, resultClicks: 0 };
    const res = await build(zero, []).getEffectQueries('s1', 'e3');
    expect(res.baselineCoverage).toBeNull();
    expect(res.resultCoverage).toBeNull();
    expect(res.rows).toEqual([]);
  });

  it('throws NotFound when the effect does not exist', async () => {
    await expect(build(null, []).getEffectQueries('s1', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});
