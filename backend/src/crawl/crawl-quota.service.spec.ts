import { pacificDate } from './crawl-quota.service';

describe('pacificDate', () => {
  it('buckets a UTC instant into the America/Los_Angeles calendar day', () => {
    // 2026-07-01T05:00:00Z is 2026-06-30 22:00 PDT → still June 30 in Pacific.
    expect(pacificDate(new Date('2026-07-01T05:00:00Z'))).toBe('2026-06-30');
  });

  it('rolls to the next Pacific day after local midnight', () => {
    // 2026-07-01T08:00:00Z is 2026-07-01 01:00 PDT.
    expect(pacificDate(new Date('2026-07-01T08:00:00Z'))).toBe('2026-07-01');
  });

  it('returns YYYY-MM-DD', () => {
    expect(pacificDate(new Date('2026-01-15T12:00:00Z'))).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
