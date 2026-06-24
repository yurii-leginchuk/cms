import { classifyAlt, needsAlt, placementHasAlt } from './alt-quality';

const URL = 'https://example.com/img/hero-banner.jpg';

describe('alt-quality', () => {
  it('distinguishes absent from empty', () => {
    expect(classifyAlt(null, URL)).toBe('absent'); // no attribute
    expect(classifyAlt('', URL)).toBe('empty'); // alt="" → decorative
  });

  it('flags placeholders and filename junk', () => {
    expect(classifyAlt('image', URL)).toBe('placeholder');
    expect(classifyAlt('Image 1', URL)).toBe('placeholder');
    expect(classifyAlt('photo', URL)).toBe('placeholder');
    expect(classifyAlt('DSC_0042.jpg', URL)).toBe('junkFilename');
    expect(classifyAlt('hero banner', URL)).toBe('junkFilename'); // matches the file name
  });

  it('accepts meaningful descriptions', () => {
    expect(classifyAlt('Team celebrating a product launch on stage', URL)).toBe('meaningful');
  });

  it('needsAlt: everything but meaningful is actionable (empty needs a decision)', () => {
    expect(needsAlt('absent')).toBe(true);
    expect(needsAlt('placeholder')).toBe(true);
    expect(needsAlt('junkFilename')).toBe(true);
    expect(needsAlt('empty')).toBe(true); // observed empty alt is a work item, not auto-decorative
    expect(needsAlt('meaningful')).toBe(false);
  });

  it('placementHasAlt: only a meaningful alt counts as covered', () => {
    expect(placementHasAlt('meaningful')).toBe(true);
    expect(placementHasAlt('empty')).toBe(false);
    expect(placementHasAlt('absent')).toBe(false);
  });
});
