/**
 * Date helpers anchored to Google Search Console's reporting timezone.
 *
 * GSC reports days in America/Los_Angeles. The rest of the codebase historically
 * mixed UTC (`toISOString().slice(0,10)`) with local-clock arithmetic, which
 * drifts a day near midnight and mis-places event markers on the impact timeline.
 * Everything that positions a change against the GSC curve must agree on the same
 * calendar, so impact code resolves "today" and does day math through here.
 *
 * Date strings are `YYYY-MM-DD`. Arithmetic treats a date as UTC-noon so adding
 * days never crosses a DST boundary into the previous/next day.
 */

export const GSC_TIMEZONE = 'America/Los_Angeles';

/** Lag before GSC data is available at all (most recent days are missing). */
export const GSC_DELAY_DAYS = 3;

const ymdFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: GSC_TIMEZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** Today's date (YYYY-MM-DD) in GSC's reporting timezone. */
export function gscToday(now: Date = new Date()): string {
  // en-CA formats as YYYY-MM-DD.
  return ymdFormatter.format(now);
}

/**
 * The most recent date GSC can be expected to have (any) data for, accounting for
 * the reporting lag. Days at or after this are "provisional" or absent.
 */
export function gscMaxAvailable(lagDays = GSC_DELAY_DAYS, now: Date = new Date()): string {
  return addDays(gscToday(now), -lagDays);
}

/** Add (or subtract) whole days to a YYYY-MM-DD string. */
export function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T12:00:00Z`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10);
}

/** Inclusive whole-day difference `b - a` (both YYYY-MM-DD). */
export function diffDays(a: string, b: string): number {
  const ta = Date.parse(`${a}T12:00:00Z`);
  const tb = Date.parse(`${b}T12:00:00Z`);
  return Math.round((tb - ta) / 86_400_000);
}

/** Clamp a date into [min, max] (inclusive). */
export function clampDate(date: string, min: string, max: string): string {
  if (date < min) return min;
  if (date > max) return max;
  return date;
}

/** Every date (inclusive) from `start` to `end` as YYYY-MM-DD. */
export function datesBetween(start: string, end: string): string[] {
  const out: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) out.push(d);
  return out;
}

/** Convert any timestamp/date to its GSC-timezone calendar day (YYYY-MM-DD). */
export function toGscDay(value: Date | string): string {
  const d = value instanceof Date ? value : new Date(value);
  return ymdFormatter.format(d);
}
