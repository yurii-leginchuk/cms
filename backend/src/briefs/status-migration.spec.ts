import { mapLegacyStatus, STATUS_MAP } from './status-migration';

describe('mapLegacyStatus', () => {
  it('maps draft → draft', () => {
    expect(mapLegacyStatus('draft')).toBe('draft');
  });

  it('maps meta_applied → applied', () => {
    expect(mapLegacyStatus('meta_applied')).toBe('applied');
  });

  it('maps archived → draft', () => {
    expect(mapLegacyStatus('archived')).toBe('draft');
  });

  it('maps renamed seo_qc_complete → in_progress', () => {
    expect(mapLegacyStatus('seo_qc_complete')).toBe('in_progress');
  });

  it('maps renamed page_optimized → applied', () => {
    expect(mapLegacyStatus('page_optimized')).toBe('applied');
  });

  it('maps unknown values → draft', () => {
    expect(mapLegacyStatus('something_else')).toBe('draft');
    expect(mapLegacyStatus('')).toBe('draft');
  });

  it('STATUS_MAP covers all legacy statuses', () => {
    expect(Object.keys(STATUS_MAP).sort()).toEqual(
      ['archived', 'draft', 'meta_applied', 'page_optimized', 'seo_qc_complete'].sort(),
    );
  });
});
