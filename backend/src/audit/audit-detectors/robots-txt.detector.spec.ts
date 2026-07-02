import {
  detectRobotsTxtRegression,
  parseRobotsDisallows,
  robotsRuleMatches,
} from './robots-txt.detector';
import { page, robots } from './spec-fixtures';

const SITE = 'https://example.com';

describe('parseRobotsDisallows', () => {
  it('parses agent-grouped disallows, ignoring comments and blanks', () => {
    const rules = parseRobotsDisallows(`
      # global
      User-agent: *
      Disallow: /wp-admin/
      Allow: /wp-admin/admin-ajax.php

      User-agent: Googlebot
      User-agent: Bingbot
      Disallow: /private/
    `);
    expect(rules).toEqual([
      { agent: '*', rule: '/wp-admin/' },
      { agent: 'googlebot', rule: '/private/' },
      { agent: 'bingbot', rule: '/private/' },
    ]);
  });

  it('empty Disallow (allow-all) produces no rule', () => {
    expect(parseRobotsDisallows('User-agent: *\nDisallow:')).toEqual([]);
  });
});

describe('robotsRuleMatches', () => {
  it('prefix match with * wildcard and $ anchor', () => {
    expect(robotsRuleMatches('/checkout', '/checkout/step-1')).toBe(true);
    expect(robotsRuleMatches('/checkout', '/pricing')).toBe(false);
    expect(robotsRuleMatches('/*.pdf$', '/files/report.pdf')).toBe(true);
    expect(robotsRuleMatches('/*.pdf$', '/files/report.pdf?x=1')).toBe(false);
    expect(robotsRuleMatches('/*?s=', '/anything?s=query')).toBe(true);
  });
});

describe('detectRobotsTxtRegression (P0 #2, diff-based)', () => {
  it('5xx robots.txt fires critical and withholds the rule diff (scopeComplete=false)', () => {
    const r = detectRobotsTxtRegression({
      current: robots({ status: 503, content: null }),
      previousContent: 'User-agent: *\nDisallow:\n',
      openRules: [],
      pages: [page(`${SITE}/pricing`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].discriminator).toBe('unreachable');
    expect(r.findings[0].severity).toBe('critical');
    expect(r.coverage.scopeComplete).toBe(false); // open rule findings must stay unconfirmed
  });

  it('a 404 robots.txt is allow-all — NOT a finding', () => {
    const r = detectRobotsTxtRegression({
      current: robots({ status: 404, content: null }),
      previousContent: null,
      openRules: [],
      pages: [page(`${SITE}/pricing`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(0);
    expect(r.coverage.scopeComplete).toBe(true);
  });

  it('first run (no baseline) produces no diff findings — delta-triggered only', () => {
    const r = detectRobotsTxtRegression({
      current: robots({ content: 'User-agent: *\nDisallow: /pricing\n' }),
      previousContent: null,
      openRules: [],
      pages: [page(`${SITE}/pricing`, { gscClicks: 100 })],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(0);
  });

  it('a NEW disallow covering a money page fires critical with clicks-at-risk evidence', () => {
    const r = detectRobotsTxtRegression({
      current: robots({ content: 'User-agent: *\nDisallow: /wp-admin/\nDisallow: /pricing\n' }),
      previousContent: 'User-agent: *\nDisallow: /wp-admin/\n',
      openRules: [],
      pages: [
        page(`${SITE}/pricing`, { gscClicks: 412 }),
        page(`${SITE}/blog`),
      ],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].discriminator).toBe('/pricing');
    expect(r.findings[0].severity).toBe('critical');
    expect(r.findings[0].evidence.gscClicksAtRisk).toBe(412);
    expect(r.findings[0].evidence.coveredPages).toBe(1);
  });

  it('a new disallow covering only un-trafficked inventory fires warning', () => {
    const r = detectRobotsTxtRegression({
      current: robots({ content: 'User-agent: *\nDisallow: /blog\n' }),
      previousContent: 'User-agent: *\nDisallow:\n',
      openRules: [],
      pages: [page(`${SITE}/blog`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].severity).toBe('warning');
  });

  it('a new disallow covering NOTHING in the inventory is config, not an alert', () => {
    const r = detectRobotsTxtRegression({
      current: robots({ content: 'User-agent: *\nDisallow: /tmp-junk/\n' }),
      previousContent: 'User-agent: *\nDisallow:\n',
      openRules: [],
      pages: [page(`${SITE}/pricing`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(0);
  });

  it('whitespace/comment churn alone never fires (rules are parsed first)', () => {
    const r = detectRobotsTxtRegression({
      current: robots({ content: '# new comment\n\nUser-agent: *\n  Disallow: /wp-admin/  \n' }),
      previousContent: 'User-agent: *\nDisallow: /wp-admin/\n',
      openRules: [],
      pages: [page(`${SITE}/wp-admin/tools`)],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(0);
  });

  it('an open rule still present is re-emitted (persisting), gone rules are not (resolvable)', () => {
    const r = detectRobotsTxtRegression({
      current: robots({ content: 'User-agent: *\nDisallow: /pricing\n' }),
      previousContent: 'User-agent: *\nDisallow: /pricing\n', // NOT new this run
      openRules: ['/pricing', '/checkout'], // /checkout has left robots.txt
      pages: [page(`${SITE}/pricing`, { gscClicks: 10 })],
      siteUrl: SITE,
    });
    expect(r.findings).toHaveLength(1);
    expect(r.findings[0].discriminator).toBe('/pricing');
    expect(r.findings[0].evidence.isNewThisRun).toBe(false);
    expect(r.coverage.scopeComplete).toBe(true); // '/checkout' absence is verified
  });
});
