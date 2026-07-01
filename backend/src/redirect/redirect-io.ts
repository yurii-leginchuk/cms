import {
  RawRedirect,
  computeFingerprint,
  normalizeRedirectUrl,
} from './redirect-normalize';

/**
 * Pure parsers + serializers for bulk redirect import/export — NO I/O, NO Nest, so
 * every format round-trips deterministically and is exhaustively unit-testable.
 *
 * Formats: CSV, Redirection native JSON (the lossless primary), Apache .htaccess,
 * and nginx. A parsed row is the format-agnostic {@link ImportRow}; the import
 * pipeline turns those into the same normalized shape the rest of the module uses
 * (via `normalizeRedirect`), so validation/diff reuse Phase-1/Phase-3 as-is.
 *
 * Honesty: a malformed line never throws the whole parse — it becomes a
 * {@link ParseError} with its 1-based row number, so the dry-run can list exactly
 * what couldn't be read.
 */

export type RedirectFormat = 'csv' | 'json' | 'apache' | 'nginx';

/** A format-agnostic parsed redirect (the editable fields; matches the plugin). */
export interface ImportRow {
  /** 1-based source line/row for per-row error reporting. */
  rowNumber: number;
  source: string;
  target: string | null;
  actionCode: number;
  matchType: string;
  regex: boolean;
  groupId: number | null;
  enabled: boolean;
  title: string | null;
}

export interface ParseError {
  rowNumber: number;
  raw: string;
  reason: string;
}

export interface ParseResult {
  format: RedirectFormat;
  rows: ImportRow[];
  errors: ParseError[];
}

const DEFAULT_CODE = 301;

// ── Format detection ─────────────────────────────────────────────────────────

/**
 * Best-effort format detection from filename + content. Extension wins when
 * unambiguous; otherwise sniff the content (JSON array/object, nginx `rewrite`/
 * `return`, apache `Redirect`/`RewriteRule`, else CSV).
 */
export function detectFormat(content: string, filename?: string): RedirectFormat {
  const ext = filename?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (ext === 'json') return 'json';
  if (ext === 'csv') return 'csv';
  if (ext === 'conf') return 'nginx';
  if (ext === 'htaccess' || filename?.toLowerCase().endsWith('.htaccess')) return 'apache';

  const trimmed = content.trim();
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) return 'json';
  if (/^\s*(rewrite\s+|return\s+30[1278]\b)/m.test(content)) return 'nginx';
  if (/^\s*(RewriteRule|Redirect(Match)?|RewriteCond)\b/m.test(content)) return 'apache';
  return 'csv';
}

/** Parse `content` in the detected (or forced) format. */
export function parseRedirects(content: string, format: RedirectFormat): ParseResult {
  switch (format) {
    case 'json': return parseJson(content);
    case 'apache': return parseApache(content);
    case 'nginx': return parseNginx(content);
    case 'csv':
    default: return parseCsv(content);
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

/** Documented column order when no header is present. */
const CSV_COLUMNS = ['source', 'target', 'code', 'match_type', 'regex', 'group', 'enabled', 'title'] as const;

const HEADER_ALIASES: Record<string, string> = {
  source: 'source', url: 'source', from: 'source', old: 'source',
  target: 'target', destination: 'target', to: 'target', new: 'target', action_data: 'target',
  code: 'code', action_code: 'code', status: 'code', type: 'code',
  match_type: 'match_type', matchtype: 'match_type', match: 'match_type',
  regex: 'regex',
  group: 'group', group_id: 'group', groupid: 'group',
  enabled: 'enabled', active: 'enabled',
  title: 'title', name: 'title',
};

export function parseCsv(content: string): ParseResult {
  const rows: ImportRow[] = [];
  const errors: ParseError[] = [];
  const lines = content.split(/\r?\n/);

  // Find the first non-empty line; if it looks like a header, use it for mapping.
  let headerCols: string[] | null = null;
  let started = false;
  let dataRow = 0;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    if (raw.trim() === '' || raw.trim().startsWith('#')) continue;
    const cells = splitCsvLine(raw);

    if (!started) {
      started = true;
      const looksHeader = cells.some((c) => HEADER_ALIASES[c.trim().toLowerCase()] !== undefined) &&
        !/^https?:\/\//i.test(cells[0]?.trim() ?? '') && !cells[0]?.trim().startsWith('/');
      if (looksHeader) {
        headerCols = cells.map((c) => HEADER_ALIASES[c.trim().toLowerCase()] ?? c.trim().toLowerCase());
        continue;
      }
    }

    dataRow += 1;
    const rowNumber = i + 1;
    const rec = mapCells(cells, headerCols);
    const source = (rec.source ?? '').trim();
    if (!source) {
      errors.push({ rowNumber, raw, reason: 'missing source' });
      continue;
    }
    const code = parseCode(rec.code);
    if (rec.code && code === null) {
      errors.push({ rowNumber, raw, reason: `unparseable status code "${rec.code}"` });
      continue;
    }
    rows.push({
      rowNumber,
      source,
      target: (rec.target ?? '').trim() || null,
      actionCode: code ?? DEFAULT_CODE,
      matchType: (rec.match_type ?? '').trim() || 'url',
      regex: parseBool(rec.regex),
      groupId: parseIntOrNull(rec.group),
      enabled: rec.enabled === undefined ? true : parseBool(rec.enabled, true),
      title: (rec.title ?? '').trim() || null,
    });
  }

  return { format: 'csv', rows, errors };
}

function mapCells(cells: string[], header: string[] | null): Record<string, string> {
  const rec: Record<string, string> = {};
  if (header) {
    header.forEach((h, idx) => { if (cells[idx] !== undefined) rec[h] = cells[idx]; });
  } else {
    CSV_COLUMNS.forEach((h, idx) => { if (cells[idx] !== undefined) rec[h] = cells[idx]; });
  }
  return rec;
}

/** Minimal RFC-4180-ish splitter: handles quoted fields with commas + "" escapes. */
export function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else cur += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      out.push(cur); cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function csvCell(v: string | number | null | undefined): string {
  const s = v == null ? '' : String(v);
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// ── Redirection native JSON ────────────────────────────────────────────────────

/**
 * The Redirection plugin's export is `{ redirects: [...] }` (or a bare array). Each
 * item carries url, match_type, action_code, action_data (url target), regex,
 * group_id, position, enabled, title — the lossless shape.
 */
export function parseJson(content: string): ParseResult {
  const rows: ImportRow[] = [];
  const errors: ParseError[] = [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    return { format: 'json', rows, errors: [{ rowNumber: 1, raw: content.slice(0, 200), reason: `invalid JSON: ${(err as Error).message}` }] };
  }
  const arr: unknown[] = Array.isArray(parsed)
    ? parsed
    : Array.isArray((parsed as Record<string, unknown>)?.redirects)
      ? ((parsed as Record<string, unknown>).redirects as unknown[])
      : [];
  if (arr.length === 0) {
    return { format: 'json', rows, errors: [{ rowNumber: 1, raw: content.slice(0, 200), reason: 'no redirects found (expected an array or { redirects: [...] })' }] };
  }

  arr.forEach((item, idx) => {
    const rowNumber = idx + 1;
    const o = item as Record<string, unknown>;
    const source = String(o.url ?? o.source ?? '').trim();
    if (!source) { errors.push({ rowNumber, raw: JSON.stringify(item).slice(0, 200), reason: 'missing url/source' }); return; }
    const target = extractJsonTarget(o);
    rows.push({
      rowNumber,
      source,
      target,
      actionCode: parseCode(o.action_code ?? o.code) ?? DEFAULT_CODE,
      matchType: String(o.match_type ?? 'url'),
      regex: parseBool(o.regex),
      groupId: parseIntOrNull(o.group_id ?? o.group),
      enabled: o.enabled === undefined ? (o.status ? String(o.status) !== 'disabled' : true) : parseBool(o.enabled, true),
      title: (o.title ? String(o.title) : '').trim() || null,
    });
  });
  return { format: 'json', rows, errors };
}

function extractJsonTarget(o: Record<string, unknown>): string | null {
  const d = o.action_data ?? o.target ?? o.to;
  if (typeof d === 'string') return d.trim() || null;
  if (d && typeof d === 'object' && typeof (d as Record<string, unknown>).url === 'string') {
    return ((d as Record<string, string>).url).trim() || null;
  }
  return null;
}

// ── Apache (.htaccess) ─────────────────────────────────────────────────────────

const APACHE_CODE: Record<string, number> = { permanent: 301, temp: 302, seeother: 303, gone: 410 };

export function parseApache(content: string): ParseResult {
  const rows: ImportRow[] = [];
  const errors: ParseError[] = [];
  content.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;
    const rowNumber = i + 1;

    // Redirect [code] /source /target   |   RedirectMatch [code] regex target
    let m = /^Redirect(Match)?\s+(?:(\d{3}|permanent|temp|seeother|gone)\s+)?(\S+)(?:\s+(\S+))?/i.exec(line);
    if (m) {
      const isMatch = !!m[1];
      const codeTok = (m[2] ?? '').toLowerCase();
      const code = codeTok ? (/^\d{3}$/.test(codeTok) ? Number(codeTok) : APACHE_CODE[codeTok] ?? DEFAULT_CODE) : DEFAULT_CODE;
      const source = m[3];
      const target = m[4] ?? null;
      if (code === 410 || !target) {
        rows.push(mkRow(rowNumber, source, null, 410, isMatch));
      } else {
        rows.push(mkRow(rowNumber, source, target, code, isMatch));
      }
      return;
    }

    // RewriteRule ^source$ target [R=301,L]
    m = /^RewriteRule\s+(\S+)\s+(\S+)(?:\s+\[([^\]]*)\])?/i.exec(line);
    if (m) {
      const flags = (m[3] ?? '').toLowerCase();
      if (!/r(=\d{3})?/.test(flags) && !flags.includes('redirect')) return; // not a redirect rule
      const code = Number(/r=(\d{3})/.exec(flags)?.[1] ?? DEFAULT_CODE);
      const source = m[1].replace(/^\^/, '/').replace(/\$$/, '');
      rows.push(mkRow(rowNumber, source.startsWith('/') ? source : `/${source}`, m[2], code, true));
      return;
    }

    if (/^Rewrite(Cond|Engine|Base)\b/i.test(line)) return; // context lines — ignore
    errors.push({ rowNumber, raw, reason: 'unrecognised Apache directive' });
  });
  return { format: 'apache', rows, errors };
}

// ── nginx ──────────────────────────────────────────────────────────────────────

export function parseNginx(content: string): ParseResult {
  const rows: ImportRow[] = [];
  const errors: ParseError[] = [];
  content.split(/\r?\n/).forEach((raw, i) => {
    const line = raw.trim().replace(/;$/, '');
    if (line === '' || line.startsWith('#')) return;
    const rowNumber = i + 1;

    // rewrite ^/source$ /target permanent|redirect
    let m = /^rewrite\s+(\S+)\s+(\S+)\s+(permanent|redirect)/i.exec(line);
    if (m) {
      const code = m[3].toLowerCase() === 'permanent' ? 301 : 302;
      const source = m[1].replace(/^\^/, '').replace(/\$$/, '');
      rows.push(mkRow(rowNumber, source.startsWith('/') ? source : `/${source}`, m[2], code, true));
      return;
    }
    // return 301 https://target;   (location-scoped; source unknown → skip w/ reason)
    m = /^return\s+(30[1278])\s+(\S+)/i.exec(line);
    if (m) {
      errors.push({ rowNumber, raw, reason: `nginx "return ${m[1]}" has no source path (location-scoped) — add it manually` });
      return;
    }
    if (/^(location|server|if)\b/i.test(line) || line === '}' || line === '{') return;
    errors.push({ rowNumber, raw, reason: 'unrecognised nginx directive' });
  });
  return { format: 'nginx', rows, errors };
}

function mkRow(rowNumber: number, source: string, target: string | null, code: number, regex: boolean): ImportRow {
  return {
    rowNumber, source: source.trim(), target: target ? target.trim() : null,
    actionCode: code, matchType: 'url', regex, groupId: null, enabled: true, title: null,
  };
}

// ── Serializers (export) ───────────────────────────────────────────────────────

/** Fields an export needs from an item (subset of RedirectItem). */
export interface ExportRedirect {
  source: string;
  target: string | null;
  actionCode: number | null;
  actionType: string | null;
  matchType: string | null;
  regex: boolean;
  groupId: number | null;
  position: number;
  enabled: boolean;
  title: string | null;
}

/** Lossless native Redirection JSON ({ redirects: [...] }). */
export function serializeJson(items: ExportRedirect[]): string {
  const redirects = items.map((i) => ({
    url: i.source,
    match_type: i.matchType ?? 'url',
    action_type: i.actionType ?? (i.target ? 'url' : 'error'),
    action_code: i.actionCode ?? DEFAULT_CODE,
    action_data: i.target ? { url: i.target } : [],
    regex: i.regex,
    group_id: i.groupId,
    position: i.position,
    enabled: i.enabled,
    title: i.title ?? '',
  }));
  return JSON.stringify({ redirects }, null, 2);
}

export function serializeCsv(items: ExportRedirect[]): string {
  const header = CSV_COLUMNS.join(',');
  const lines = items.map((i) => [
    csvCell(i.source), csvCell(i.target), csvCell(i.actionCode ?? DEFAULT_CODE),
    csvCell(i.matchType ?? 'url'), csvCell(i.regex ? 1 : 0), csvCell(i.groupId),
    csvCell(i.enabled ? 1 : 0), csvCell(i.title),
  ].join(','));
  return [header, ...lines].join('\n');
}

export function serializeApache(items: ExportRedirect[]): string {
  return items.map((i) => {
    if (!i.enabled) return `# (disabled) ${i.source}`;
    if (i.actionCode === 410 || !i.target) return `Redirect 410 ${i.source}`;
    if (i.regex) return `RedirectMatch ${i.actionCode ?? DEFAULT_CODE} ${i.source} ${i.target}`;
    return `Redirect ${i.actionCode ?? DEFAULT_CODE} ${i.source} ${i.target}`;
  }).join('\n');
}

export function serializeNginx(items: ExportRedirect[]): string {
  return items.map((i) => {
    if (!i.enabled) return `# (disabled) ${i.source}`;
    const perm = (i.actionCode ?? DEFAULT_CODE) === 301 ? 'permanent' : 'redirect';
    if (i.actionCode === 410 || !i.target) return `# 410 ${i.source} (Gone — express via a location block)`;
    const src = i.regex ? i.source : `^${i.source}$`;
    return `rewrite ${src} ${i.target} ${perm};`;
  }).join('\n');
}

export function serialize(items: ExportRedirect[], format: RedirectFormat): string {
  switch (format) {
    case 'json': return serializeJson(items);
    case 'apache': return serializeApache(items);
    case 'nginx': return serializeNginx(items);
    case 'csv':
    default: return serializeCsv(items);
  }
}

// ── Parse-value helpers (exported for tests) ────────────────────────────────────

export function parseCode(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim());
  if (!Number.isInteger(n)) return null;
  return [301, 302, 303, 307, 308, 404, 410].includes(n) ? n : null;
}

export function parseBool(v: unknown, dflt = false): boolean {
  if (v == null || v === '') return dflt;
  const s = String(v).trim().toLowerCase();
  if (['1', 'true', 'yes', 'y', 'enabled', 'on'].includes(s)) return true;
  if (['0', 'false', 'no', 'n', 'disabled', 'off'].includes(s)) return false;
  return dflt;
}

function parseIntOrNull(v: unknown): number | null {
  if (v == null || v === '') return null;
  const n = Number(String(v).trim());
  return Number.isInteger(n) ? n : null;
}

/**
 * A stable identity fingerprint for a parsed import row, computed with the SAME
 * Phase-1 material (normalized source/target + match/regex/group/action) so the
 * dry-run diff can match import rows to existing redirects deterministically.
 */
export function importRowFingerprint(row: ImportRow, mappingVersion: number): string {
  const actionType = row.target ? 'url' : 'error';
  return computeFingerprint({
    sourceNormalized: normalizeRedirectUrl(row.source),
    matchType: row.matchType,
    regex: row.regex,
    groupId: row.groupId,
    actionType,
    actionCode: row.actionCode,
    targetNormalized: row.target ? normalizeRedirectUrl(row.target) : null,
    mappingVersion,
  });
}

/** Adapt an import row to the raw-plugin shape (so `normalizeRedirect` can run). */
export function importRowToRaw(row: ImportRow): RawRedirect {
  return {
    id: null,
    url: row.source,
    match_type: row.matchType,
    action_type: row.target ? 'url' : 'error',
    action_code: row.actionCode,
    action_data: row.target,
    match_data: null,
    regex: row.regex ? 1 : 0,
    group_id: row.groupId,
    position: 0,
    status: row.enabled ? 'enabled' : 'disabled',
    last_access: null,
    last_count: 0,
    title: row.title,
  };
}
