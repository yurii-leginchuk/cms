/**
 * Approximate organic CTR-by-position curve, used to judge whether a page's CTR
 * is over- or under-performing for the rank it sits at. A title rewrite that
 * lifts CTR without moving position is a real win - but raw CTR is meaningless
 * without the position context (CTR at rank 3 ≫ CTR at rank 8). This lets the UI
 * say "actual 4.1% vs expected 3.2% at pos 6 → over-performing".
 *
 * Values are a blended industry baseline (desktop+mobile organic); treat as a
 * reference shape, not ground truth. Returns a fraction (0..1).
 */
const CTR_BY_POSITION: Record<number, number> = {
  1: 0.28, 2: 0.15, 3: 0.11, 4: 0.08, 5: 0.06,
  6: 0.05, 7: 0.04, 8: 0.032, 9: 0.028, 10: 0.025,
  11: 0.018, 12: 0.015, 13: 0.013, 14: 0.012, 15: 0.011,
  20: 0.006, 30: 0.003, 50: 0.001,
}

const KNOTS = Object.keys(CTR_BY_POSITION).map(Number).sort((a, b) => a - b)

/** Expected CTR (fraction 0..1) for an average position, linearly interpolated. */
export function expectedCtr(position: number): number {
  if (position <= 1) return CTR_BY_POSITION[1]
  if (position >= 50) return CTR_BY_POSITION[50]
  let lo = KNOTS[0]
  let hi = KNOTS[KNOTS.length - 1]
  for (let i = 0; i < KNOTS.length - 1; i++) {
    if (position >= KNOTS[i] && position <= KNOTS[i + 1]) {
      lo = KNOTS[i]; hi = KNOTS[i + 1]; break
    }
  }
  const t = (position - lo) / (hi - lo)
  return CTR_BY_POSITION[lo] + t * (CTR_BY_POSITION[hi] - CTR_BY_POSITION[lo])
}

/** True when an average position sits in the striking-distance band (4–15). */
export function isStrikingDistance(position: number): boolean {
  return position >= 4 && position <= 15
}
