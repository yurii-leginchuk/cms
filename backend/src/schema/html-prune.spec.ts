import { prunePageHtml } from './html-prune';

const html = `
<html>
<head>
  <title>Acme</title>
  <meta property="og:title" content="Acme Co">
  <meta name="description" content="We do things">
  <meta name="viewport" content="width=device-width">
  <link rel="canonical" href="https://acme.test/">
  <link rel="stylesheet" href="/style.css">
  <style>.x{color:red}</style>
  <script type="application/ld+json">{"@type":"Organization"}</script>
</head>
<body class="page" data-elementor-id="9">
  <header class="hdr"><nav class="menu"><a href="/x" class="lnk">X</a></nav></header>
  <main>
    <div class="elementor-widget" id="faq" data-id="abc" style="margin:0">
      <h1 class="title">Acme Plumbing</h1>
      <div itemscope itemtype="https://schema.org/LocalBusiness">
        <span itemprop="name">Acme Plumbing</span>
        <a href="tel:+15551234567" itemprop="telephone">Call</a>
        <address itemprop="address">12 King St</address>
        <time datetime="2026-01-02">Jan 2</time>
      </div>
      <img src="/a.webp" alt="Team photo" class="img" loading="lazy" srcset="/a-300.webp 300w">
    </div>
    <div class="empty" data-x="1">   </div>
  </main>
</body>
</html>`;

describe('prunePageHtml', () => {
  const out = prunePageHtml(html);

  it('removes scripts, styles and stylesheet links', () => {
    expect(out).not.toContain('ld+json');
    expect(out).not.toContain('color:red');
    expect(out).not.toContain('style.css');
  });

  it('strips class/style/data-* presentational attributes (but keeps id)', () => {
    expect(out).not.toContain('class=');
    expect(out).not.toContain('data-elementor-id');
    expect(out).not.toContain('data-id');
    expect(out).not.toContain('loading=');
    expect(out).not.toContain('srcset=');
    expect(out).toContain('id="faq"');
  });

  it('keeps semantic structure + schema-relevant attributes', () => {
    expect(out).toContain('itemprop="name"');
    expect(out).toContain('itemtype="https://schema.org/LocalBusiness"');
    expect(out).toContain('href="tel:+15551234567"');
    expect(out).toContain('datetime="2026-01-02"');
    expect(out).toContain('alt="Team photo"');
    expect(out).toContain('Acme Plumbing');
  });

  it('keeps schema-relevant meta + canonical, drops viewport', () => {
    expect(out).toContain('og:title');
    expect(out).toContain('We do things');
    expect(out).toContain('rel="canonical"');
    expect(out).not.toContain('width=device-width');
  });

  it('drops empty wrapper elements', () => {
    expect(out).not.toContain('data-x');
  });

  it('does not truncate large input', () => {
    const big = prunePageHtml('<body>' + '<p>hello world</p>'.repeat(5000) + '</body>');
    // No length cap — the full pruned content is returned, no truncation marker.
    expect(big).not.toContain('truncated');
    expect(big.length).toBeGreaterThan(50000);
  });

  it('returns empty string for empty input', () => {
    expect(prunePageHtml('')).toBe('');
  });
});
