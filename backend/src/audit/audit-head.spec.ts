import { parseHeadSignal, titleLooks404 } from './audit-head';

describe('parseHeadSignal', () => {
  it('returns null for empty/absent html (no data ≠ data says fine)', () => {
    expect(parseHeadSignal(null)).toBeNull();
    expect(parseHeadSignal('')).toBeNull();
    expect(parseHeadSignal('   ')).toBeNull();
  });

  it('extracts title, robots meta and canonical verbatim', () => {
    const s = parseHeadSignal(`
      <html><head>
        <title> Pricing – Example </title>
        <meta name="robots" content="noindex, follow">
        <link rel="canonical" href="https://example.com/pricing/">
      </head><body></body></html>`)!;
    expect(s.title).toBe('Pricing – Example');
    expect(s.robotsMeta).toBe('noindex, follow');
    expect(s.robotsNoindex).toBe(true);
    expect(s.canonical).toBe('https://example.com/pricing/');
  });

  it('detects noindex via the `none` token and the googlebot meta', () => {
    expect(parseHeadSignal('<meta name="robots" content="none">')!.robotsNoindex).toBe(true);
    expect(parseHeadSignal('<meta name="googlebot" content="NOINDEX">')!.robotsNoindex).toBe(true);
  });

  it('does NOT flag nofollow-only or unrelated tokens as noindex', () => {
    const s = parseHeadSignal('<meta name="robots" content="nofollow, max-snippet:-1">')!;
    expect(s.robotsNoindex).toBe(false);
    expect(s.robotsMeta).toBe('nofollow, max-snippet:-1');
  });

  it('index,follow is not noindex', () => {
    expect(parseHeadSignal('<meta name="robots" content="index, follow">')!.robotsNoindex).toBe(false);
  });

  it('collects http:// assets (mixed content) and ignores https ones', () => {
    const s = parseHeadSignal(`
      <html><body>
        <script src="http://cdn.example.com/a.js"></script>
        <img src="https://example.com/fine.png">
        <link rel="stylesheet" href="http://example.com/style.css">
      </body></html>`)!;
    expect(s.httpAssets).toEqual([
      'http://cdn.example.com/a.js',
      'http://example.com/style.css',
    ]);
  });

  it('counts hreflang alternates', () => {
    const s = parseHeadSignal(`
      <link rel="alternate" hreflang="en" href="https://example.com/">
      <link rel="alternate" hreflang="fr" href="https://example.com/fr/">`)!;
    expect(s.hreflangCount).toBe(2);
  });
});

describe('titleLooks404', () => {
  it('matches common not-found templates', () => {
    expect(titleLooks404('Page not found – Example')).toBe(true);
    expect(titleLooks404('404 Error')).toBe(true);
    expect(titleLooks404('Oops! That page doesn’t exist')).toBe(false); // curly apostrophe — pattern uses straight
    expect(titleLooks404("Oops! That page doesn't exist")).toBe(true);
    expect(titleLooks404('Error 404 - Not Found')).toBe(true);
  });

  it('does not fire on ordinary titles', () => {
    expect(titleLooks404('Pool Renovation Pricing')).toBe(false);
    expect(titleLooks404('Room 4040 — Book now')).toBe(false);
    expect(titleLooks404(null)).toBe(false);
  });
});
