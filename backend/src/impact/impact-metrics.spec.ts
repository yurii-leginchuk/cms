import { aggregate, compare, rollingWeighted, isSignificant, DayPoint } from './impact-metrics';

describe('impact-metrics', () => {
  describe('aggregate', () => {
    it('sums clicks/impressions and recomputes CTR from totals (never averages rates)', () => {
      const points: DayPoint[] = [
        { date: '2026-01-01', clicks: 10, impressions: 100, position: 5 }, // CTR 10%
        { date: '2026-01-02', clicks: 90, impressions: 900, position: 3 }, // CTR 10%
      ];
      const a = aggregate(points);
      expect(a.clicks).toBe(100);
      expect(a.impressions).toBe(1000);
      expect(a.ctr).toBeCloseTo(0.1, 10);
    });

    it('weights position by impressions, not a naive mean', () => {
      const points: DayPoint[] = [
        { date: '2026-01-01', clicks: 0, impressions: 100, position: 2 },
        { date: '2026-01-02', clicks: 0, impressions: 900, position: 12 },
      ];
      // Naive mean would be 7; impression-weighted = (2*100 + 12*900)/1000 = 11
      expect(aggregate(points).position).toBeCloseTo(11, 10);
    });

    it('returns zeros (not NaN) when there are no impressions', () => {
      const a = aggregate([{ date: '2026-01-01', clicks: 0, impressions: 0, position: 0 }]);
      expect(a).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
    });

    it('handles an empty series', () => {
      expect(aggregate([])).toEqual({ clicks: 0, impressions: 0, ctr: 0, position: 0 });
    });
  });

  describe('compare', () => {
    const before = { clicks: 100, impressions: 1000, ctr: 0.1, position: 8 };

    it('computes abs and pct deltas with higher-is-better for clicks', () => {
      const after = { clicks: 150, impressions: 1200, ctr: 0.125, position: 6 };
      const c = compare(before, after);
      expect(c.clicks.abs).toBe(50);
      expect(c.clicks.pct).toBeCloseTo(50, 10);
      expect(c.clicks.improved).toBe(true);
    });

    it('treats a lower position as improved (lower-is-better)', () => {
      const after = { clicks: 100, impressions: 1000, ctr: 0.1, position: 5 };
      const c = compare(before, after);
      expect(c.position.abs).toBe(-3);
      expect(c.position.improved).toBe(true);
    });

    it('guards against divide-by-zero baselines (pct null)', () => {
      const c = compare({ clicks: 0, impressions: 0, ctr: 0, position: 0 }, {
        clicks: 5, impressions: 50, ctr: 0.1, position: 9,
      });
      expect(c.clicks.pct).toBeNull();
      expect(c.clicks.abs).toBe(5);
    });

    it('returns null deltas for an unmeasured (pending) window', () => {
      const c = compare(before, null);
      expect(c.clicks.after).toBeNull();
      expect(c.clicks.abs).toBeNull();
      expect(c.clicks.improved).toBeNull();
    });

    it('does not mark a zero change as improved', () => {
      const c = compare(before, { ...before });
      expect(c.clicks.improved).toBe(false);
    });
  });

  describe('rollingWeighted', () => {
    const points: DayPoint[] = [
      { date: '2026-01-01', clicks: 10, impressions: 100, position: 10 },
      { date: '2026-01-02', clicks: 10, impressions: 100, position: 8 },
      { date: '2026-01-03', clicks: 10, impressions: 100, position: 6 },
    ];

    it('passes raw points through when window <= 1', () => {
      const r = rollingWeighted(points, 1);
      expect(r.map((p) => p.position)).toEqual([10, 8, 6]);
    });

    it('produces a trailing impression-weighted aggregate per point', () => {
      const r = rollingWeighted(points, 3);
      // last point = weighted avg of all three (equal impressions) = (10+8+6)/3 = 8
      expect(r[2].position).toBeCloseTo(8, 10);
      expect(r[2].clicks).toBe(30);
      expect(r[0].position).toBeCloseTo(10, 10); // first point only sees itself
    });
  });

  describe('isSignificant', () => {
    it('flags low-impression windows', () => {
      expect(isSignificant({ clicks: 1, impressions: 50, ctr: 0.02, position: 3 }, 100)).toBe(false);
      expect(isSignificant({ clicks: 1, impressions: 150, ctr: 0.006, position: 3 }, 100)).toBe(true);
    });
  });
});
