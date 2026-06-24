import {
  canonicalImageKey,
  normalizeImageUrl,
  resolveImageUrl,
  imageFileName,
} from './image-identity';

const PAGE = 'https://example.com/blog/post';

describe('image-identity', () => {
  describe('resolveImageUrl', () => {
    it('resolves relative, absolute and protocol-relative srcs', () => {
      expect(resolveImageUrl('/img/a.jpg', PAGE)).toBe('https://example.com/img/a.jpg');
      expect(resolveImageUrl('https://cdn.x/a.jpg', PAGE)).toBe('https://cdn.x/a.jpg');
      expect(resolveImageUrl('//cdn.x/a.jpg', PAGE)).toBe('https://cdn.x/a.jpg');
    });
    it('rejects data URIs and blanks', () => {
      expect(resolveImageUrl('data:image/png;base64,xxxx', PAGE)).toBeNull();
      expect(resolveImageUrl('   ', PAGE)).toBeNull();
    });
  });

  describe('normalizeImageUrl — variant folding', () => {
    const key = (u: string) => normalizeImageUrl(u)?.canonicalKey;

    it('folds http/https to one key', () => {
      expect(key('http://example.com/a.jpg')).toBe(key('https://example.com/a.jpg'));
    });
    it('strips WP resize suffix', () => {
      expect(key('https://example.com/hero-300x200.jpg')).toBe(
        key('https://example.com/hero.jpg'),
      );
    });
    it('strips -scaled and @2x variants', () => {
      expect(key('https://example.com/p-scaled.jpg')).toBe(key('https://example.com/p.jpg'));
      expect(key('https://example.com/p@2x.png')).toBe(key('https://example.com/p.png'));
    });
    it('drops query strings (cache busters / resize params)', () => {
      expect(key('https://example.com/a.jpg?ver=5')).toBe(key('https://example.com/a.jpg'));
    });
    it('lowercases host but keeps case-sensitive path', () => {
      expect(key('https://EXAMPLE.com/Path/A.jpg')).toBe('example.com/Path/A.jpg');
    });
    it('rejects non-http protocols', () => {
      expect(normalizeImageUrl('ftp://x/a.jpg')).toBeNull();
    });
  });

  it('canonicalImageKey end-to-end across variants of one file', () => {
    const a = canonicalImageKey('/wp-content/hero-1024x768.jpg?ver=2', PAGE);
    const b = canonicalImageKey('https://example.com/wp-content/hero.jpg', PAGE);
    const c = canonicalImageKey('//example.com/wp-content/hero-scaled.jpg', PAGE);
    expect(a?.canonicalKey).toBe(b?.canonicalKey);
    expect(a?.canonicalKey).toBe(c?.canonicalKey);
    expect(a?.ext).toBe('jpg');
  });

  it('imageFileName extracts the decoded file name', () => {
    expect(imageFileName('https://example.com/img/Hello%20World.png')).toBe('Hello World.png');
  });
});
