import { normalize, registrableDomain } from './normalize';

const URL = 'https://example.com/page';

describe('registrableDomain', () => {
  it('reduces a host to its last two labels', () => {
    expect(registrableDomain('www.evil-casino.ru')).toBe('evil-casino.ru');
    expect(registrableDomain('example.com')).toBe('example.com');
  });
});

describe('normalize', () => {
  it('extracts main text and is stable for identical content', () => {
    const html = `<html><body><nav>Home Menu</nav><main><article>
      <h1>Welcome to Acme</h1><p>We sell quality plumbing services.</p>
    </article></main><footer>copyright</footer></body></html>`;
    const a = normalize(html, URL);
    const b = normalize(html, URL);
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.mainText).toContain('quality plumbing');
    expect(a.mainText).not.toContain('Home Menu'); // nav stripped
  });

  it('collects only external script origins and link domains', () => {
    const html = `<html><head>
      <script src="/local.js"></script>
      <script src="https://evil.example.net/inject.js"></script>
    </head><body><main>
      <a href="/internal">internal</a>
      <a href="https://1xbet.com/promo">bet</a>
    </main></body></html>`;
    const n = normalize(html, URL);
    expect(n.externalScriptOrigins).toEqual(['evil.example.net']);
    expect(n.externalLinkDomains).toEqual(['1xbet.com']);
  });

  it('produces different hashes for different content', () => {
    const a = normalize('<main><p>casino bonus offers</p></main>', URL);
    const b = normalize('<main><p>plumbing services</p></main>', URL);
    expect(a.contentHash).not.toBe(b.contentHash);
  });
});
