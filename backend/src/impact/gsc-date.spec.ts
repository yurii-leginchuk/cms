import {
  gscToday, gscMaxAvailable, addDays, diffDays, clampDate, datesBetween, toGscDay,
} from './gsc-date';

describe('gsc-date', () => {
  it('resolves "today" in the GSC (Los Angeles) timezone, not UTC', () => {
    // 2026-01-02 06:00 UTC is still 2026-01-01 22:00 in Los Angeles.
    const at = new Date('2026-01-02T06:00:00Z');
    expect(gscToday(at)).toBe('2026-01-01');
  });

  it('subtracts the reporting lag for max-available', () => {
    const at = new Date('2026-01-10T20:00:00Z'); // LA: 2026-01-10
    expect(gscMaxAvailable(3, at)).toBe('2026-01-07');
  });

  it('adds and subtracts days without DST drift', () => {
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09'); // US DST spring-forward
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('computes inclusive day differences', () => {
    expect(diffDays('2026-01-01', '2026-01-01')).toBe(0);
    expect(diffDays('2026-01-01', '2026-01-29')).toBe(28);
  });

  it('clamps into a range', () => {
    expect(clampDate('2026-01-01', '2026-01-05', '2026-01-10')).toBe('2026-01-05');
    expect(clampDate('2026-01-20', '2026-01-05', '2026-01-10')).toBe('2026-01-10');
    expect(clampDate('2026-01-07', '2026-01-05', '2026-01-10')).toBe('2026-01-07');
  });

  it('lists inclusive dates between two days', () => {
    expect(datesBetween('2026-01-01', '2026-01-03')).toEqual([
      '2026-01-01', '2026-01-02', '2026-01-03',
    ]);
  });

  it('maps a timestamp to its LA calendar day', () => {
    expect(toGscDay('2026-01-02T06:00:00Z')).toBe('2026-01-01');
  });
});
