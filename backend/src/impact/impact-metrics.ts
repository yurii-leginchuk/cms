/**
 * The single source of truth for how Search Console metrics are aggregated and
 * compared on the Optimization Impact feature.
 *
 * Two metrics are RATES and must never be averaged across days or pages:
 *  - CTR      = Σclicks / Σimpressions
 *  - position = Σ(position · impressions) / Σimpressions   (impression-weighted)
 *
 * GSC already returns an impression-weighted position *within* a single row/day,
 * but that value becomes wrong the moment you average it with another row. Every
 * rollup (a date range, a smoothed window, a site total) goes through here so the
 * effects service, the series endpoint, and CSV export can never disagree.
 */

export interface DayPoint {
  date: string; // YYYY-MM-DD
  clicks: number;
  impressions: number;
  /** Impression-weighted average position for this day, as GSC returns it. */
  position: number;
}

export interface Aggregate {
  clicks: number;
  impressions: number;
  /** Ratio 0..1 (NOT percent). */
  ctr: number;
  /** Impression-weighted average rank; 0 when there are no impressions. */
  position: number;
}

const ZERO: Aggregate = { clicks: 0, impressions: 0, ctr: 0, position: 0 };

/** Correctly roll up daily points into one aggregate. */
export function aggregate(points: DayPoint[]): Aggregate {
  if (points.length === 0) return { ...ZERO };
  let clicks = 0;
  let impressions = 0;
  let weightedPosSum = 0;
  for (const p of points) {
    clicks += p.clicks;
    impressions += p.impressions;
    weightedPosSum += p.position * p.impressions;
  }
  return {
    clicks,
    impressions,
    ctr: impressions > 0 ? clicks / impressions : 0,
    position: impressions > 0 ? weightedPosSum / impressions : 0,
  };
}

export interface MetricDelta {
  before: number;
  after: number | null;
  /** after - before; null until measured. */
  abs: number | null;
  /** Percent change vs before; null when before is 0 (undefined) or not measured. */
  pct: number | null;
  /** True when the change is in the favorable direction for this metric. */
  improved: boolean | null;
}

function makeDelta(before: number, after: number | null, lowerIsBetter: boolean): MetricDelta {
  if (after === null) return { before, after: null, abs: null, pct: null, improved: null };
  const abs = after - before;
  const pct = before !== 0 ? (abs / before) * 100 : null;
  const improved = abs === 0 ? false : lowerIsBetter ? abs < 0 : abs > 0;
  return { before, after, abs, pct, improved };
}

export interface ImpactComparison {
  clicks: MetricDelta;
  impressions: MetricDelta;
  ctr: MetricDelta;
  position: MetricDelta;
}

/**
 * Compare a measured "after" window against a "before" baseline. Pass null for an
 * unmeasured window (pending effect) to get before-only deltas. Position uses
 * lower-is-better semantics; the other three higher-is-better.
 */
export function compare(before: Aggregate, after: Aggregate | null): ImpactComparison {
  return {
    clicks: makeDelta(before.clicks, after ? after.clicks : null, false),
    impressions: makeDelta(before.impressions, after ? after.impressions : null, false),
    ctr: makeDelta(before.ctr, after ? after.ctr : null, false),
    position: makeDelta(before.position, after ? after.position : null, true),
  };
}

/**
 * Trailing impression-weighted rolling aggregate, for honestly smoothing the
 * noisy day-level position/CTR line without averaging rates. Each output point is
 * the correct aggregate of the trailing `window` days (inclusive). Clicks and
 * impressions are reported as the trailing-window total so the smoothed CTR/
 * position stay internally consistent with them.
 */
export function rollingWeighted(points: DayPoint[], window: number): (Aggregate & { date: string })[] {
  if (window <= 1) {
    return points.map((p) => ({ date: p.date, ...aggregate([p]) }));
  }
  const out: (Aggregate & { date: string })[] = [];
  for (let i = 0; i < points.length; i++) {
    const slice = points.slice(Math.max(0, i - window + 1), i + 1);
    out.push({ date: points[i].date, ...aggregate(slice) });
  }
  return out;
}

/** Whether an aggregate has enough impressions to be treated as significant. */
export function isSignificant(agg: Aggregate, minImpressions: number): boolean {
  return agg.impressions >= minImpressions;
}
