import { detectRedirectCloak } from './redirect-cloak';

const url = 'https://example.com/page';

describe('detectRedirectCloak', () => {
  it('flags a bot-only external redirect', () => {
    const bot = {
      requestedUrl: url,
      finalUrl: 'https://evil-casino.ru/landing',
      redirectChain: [{ url, status: 302 }],
    };
    const user = { requestedUrl: url, finalUrl: url, redirectChain: [] };
    const signals = detectRedirectCloak(bot, user);
    expect(signals).toHaveLength(1);
    expect(signals[0].code).toBe('bot_only_external_redirect');
    expect(signals[0].malicious).toBe(true);
    expect(signals[0].evidence.target).toBe('evil-casino.ru');
  });

  it('does not flag when both axes redirect to the same external host', () => {
    const chain = [{ url, status: 301 }];
    const bot = { requestedUrl: url, finalUrl: 'https://newsite.com/', redirectChain: chain };
    const user = { requestedUrl: url, finalUrl: 'https://newsite.com/', redirectChain: chain };
    expect(detectRedirectCloak(bot, user)).toHaveLength(0);
  });

  it('ignores same-domain redirects (http→https, trailing slash)', () => {
    const bot = {
      requestedUrl: url,
      finalUrl: 'https://www.example.com/page/',
      redirectChain: [{ url, status: 301 }],
    };
    const user = { requestedUrl: url, finalUrl: url, redirectChain: [] };
    expect(detectRedirectCloak(bot, user)).toHaveLength(0);
  });
});
