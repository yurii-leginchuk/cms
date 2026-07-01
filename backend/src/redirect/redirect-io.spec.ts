import {
  detectFormat,
  parseRedirects,
  parseCsv,
  parseJson,
  parseApache,
  parseNginx,
  serialize,
  serializeJson,
  splitCsvLine,
  parseCode,
  parseBool,
  importRowFingerprint,
  ExportRedirect,
} from './redirect-io';
import { MAPPING_VERSION } from './redirect-normalize';

function exp(over: Partial<ExportRedirect> = {}): ExportRedirect {
  return {
    source: '/a', target: '/b', actionCode: 301, actionType: 'url', matchType: 'url',
    regex: false, groupId: 1, position: 0, enabled: true, title: null, ...over,
  };
}

describe('detectFormat', () => {
  it('detects by extension then content', () => {
    expect(detectFormat('[]', 'x.json')).toBe('json');
    expect(detectFormat('a,b', 'x.csv')).toBe('csv');
    expect(detectFormat('{ "redirects": [] }')).toBe('json');
    expect(detectFormat('rewrite ^/a$ /b permanent;')).toBe('nginx');
    expect(detectFormat('Redirect 301 /a /b')).toBe('apache');
    expect(detectFormat('/old,/new,301')).toBe('csv');
  });
});

describe('parseCsv', () => {
  it('parses a headerless CSV in the documented column order', () => {
    const { rows, errors } = parseCsv('/old,/new,301,url,0,1,1,Title');
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ source: '/old', target: '/new', actionCode: 301, regex: false, enabled: true, title: 'Title', groupId: 1 });
  });

  it('honours a header row with aliases and any column order', () => {
    const { rows } = parseCsv('destination,url,status\n/new,/old,302');
    expect(rows[0]).toMatchObject({ source: '/old', target: '/new', actionCode: 302 });
  });

  it('skips comment + blank lines and reports per-row errors with line numbers', () => {
    const { rows, errors } = parseCsv('# comment\n/old,/new,301\n\n,/x,301\n/z,/y,999');
    expect(rows).toHaveLength(1);
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatchObject({ rowNumber: 4, reason: 'missing source' });
    expect(errors[1].reason).toContain('unparseable status code');
  });

  it('defaults code to 301 and enabled to true when absent', () => {
    const { rows } = parseCsv('/old,/new');
    expect(rows[0].actionCode).toBe(301);
    expect(rows[0].enabled).toBe(true);
  });
});

describe('splitCsvLine', () => {
  it('handles quoted commas and escaped quotes', () => {
    expect(splitCsvLine('/a,"b,c",301')).toEqual(['/a', 'b,c', '301']);
    expect(splitCsvLine('/a,"say ""hi""",301')).toEqual(['/a', 'say "hi"', '301']);
  });
});

describe('parseJson (Redirection native)', () => {
  it('parses { redirects: [...] } with action_data.url and status', () => {
    const { rows, errors } = parseJson(JSON.stringify({
      redirects: [{ url: '/old', action_code: 301, action_data: { url: '/new' }, match_type: 'url', regex: false, group_id: 2, enabled: true, title: 'T' }],
    }));
    expect(errors).toHaveLength(0);
    expect(rows[0]).toMatchObject({ source: '/old', target: '/new', actionCode: 301, groupId: 2, title: 'T' });
  });

  it('accepts a bare array and string action_data', () => {
    const { rows } = parseJson(JSON.stringify([{ url: '/old', action_code: 302, action_data: '/new' }]));
    expect(rows[0]).toMatchObject({ source: '/old', target: '/new', actionCode: 302 });
  });

  it('reports invalid JSON as a single error, never throws', () => {
    const { rows, errors } = parseJson('{ not json');
    expect(rows).toHaveLength(0);
    expect(errors[0].reason).toContain('invalid JSON');
  });
});

describe('parseApache', () => {
  it('parses Redirect, RedirectMatch and RewriteRule', () => {
    const { rows } = parseApache([
      'Redirect 301 /old /new',
      'Redirect permanent /a /b',
      'RedirectMatch 302 ^/x/(.*)$ /y/$1',
      'RewriteRule ^old-page$ /new-page [R=301,L]',
      'Redirect 410 /gone',
    ].join('\n'));
    expect(rows).toHaveLength(5);
    expect(rows[0]).toMatchObject({ source: '/old', target: '/new', actionCode: 301, regex: false });
    expect(rows[1].actionCode).toBe(301);
    expect(rows[2]).toMatchObject({ actionCode: 302, regex: true });
    expect(rows[3]).toMatchObject({ target: '/new-page', actionCode: 301, regex: true });
    expect(rows[4]).toMatchObject({ source: '/gone', target: null, actionCode: 410 });
  });

  it('ignores RewriteCond/Engine context lines and flags unknown directives', () => {
    const { rows, errors } = parseApache('RewriteEngine On\nRewriteCond %{HTTP_HOST} x\nGarbage line here');
    expect(rows).toHaveLength(0);
    expect(errors).toHaveLength(1);
  });
});

describe('parseNginx', () => {
  it('parses rewrite ... permanent/redirect', () => {
    const { rows } = parseNginx('rewrite ^/old$ /new permanent;\nrewrite ^/a$ /b redirect;');
    expect(rows[0]).toMatchObject({ source: '/old', target: '/new', actionCode: 301, regex: true });
    expect(rows[1].actionCode).toBe(302);
  });

  it('flags a location-scoped `return` (no source) as a per-row error', () => {
    const { rows, errors } = parseNginx('return 301 https://example.com/new;');
    expect(rows).toHaveLength(0);
    expect(errors[0].reason).toContain('no source path');
  });
});

describe('serialize + round-trip', () => {
  const items = [
    exp({ source: '/old', target: '/new', actionCode: 301, matchType: 'url', regex: false, groupId: 3, title: 'Hello' }),
    exp({ source: '/x', target: '/y', actionCode: 302, regex: true, groupId: 3 }),
    exp({ source: '/gone', target: null, actionCode: 410, actionType: 'error', groupId: 3 }),
  ];

  it('round-trips native JSON losslessly (export → import → same normalized set)', () => {
    const json = serializeJson(items);
    const { rows, errors } = parseJson(json);
    expect(errors).toHaveLength(0);
    expect(rows).toHaveLength(3);
    // Fingerprints (identity) must match between original and re-imported.
    const origFps = items.map((i) => importRowFingerprint({
      rowNumber: 0, source: i.source, target: i.target, actionCode: i.actionCode ?? 301,
      matchType: i.matchType ?? 'url', regex: i.regex, groupId: i.groupId, enabled: i.enabled, title: i.title,
    }, MAPPING_VERSION)).sort();
    const rtFps = rows.map((r) => importRowFingerprint(r, MAPPING_VERSION)).sort();
    expect(rtFps).toEqual(origFps);
  });

  it('round-trips CSV', () => {
    const csv = serialize(items, 'csv');
    const { rows } = parseCsv(csv);
    expect(rows.map((r) => r.source)).toEqual(['/old', '/x', '/gone']);
    expect(rows[1].regex).toBe(true);
    expect(rows[2].actionCode).toBe(410);
  });

  it('apache/nginx serialize includes the right directives', () => {
    const apache = serialize(items, 'apache');
    expect(apache).toContain('Redirect 301 /old /new');
    expect(apache).toContain('RedirectMatch 302 /x /y');
    expect(apache).toContain('Redirect 410 /gone');
    const nginx = serialize(items, 'nginx');
    expect(nginx).toContain('rewrite ^/old$ /new permanent;');
  });
});

describe('value parsers', () => {
  it('parseCode only accepts known redirect codes', () => {
    expect(parseCode('301')).toBe(301);
    expect(parseCode('410')).toBe(410);
    expect(parseCode('200')).toBeNull();
    expect(parseCode('abc')).toBeNull();
    expect(parseCode('')).toBeNull();
  });

  it('parseBool maps common truthy/falsey tokens', () => {
    expect(parseBool('yes')).toBe(true);
    expect(parseBool('disabled')).toBe(false);
    expect(parseBool('', true)).toBe(true);
  });
});

describe('parseRedirects dispatch', () => {
  it('routes to the right parser', () => {
    expect(parseRedirects('/a,/b,301', 'csv').rows).toHaveLength(1);
    expect(parseRedirects('rewrite ^/a$ /b permanent;', 'nginx').rows).toHaveLength(1);
  });
});
