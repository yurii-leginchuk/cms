/**
 * Pure JSON-LD detection + schema.org structural validation.
 *
 * No DB, no network, no NestJS — deterministic and unit-tested (see
 * schema-validator.spec.ts), mirroring the `structure-parser` / `proposal-
 * validation` modules. Phase 1 of the schema module: detect every JSON-LD
 * block on a page and check it is *structurally* valid schema.org. It does NOT
 * encode Google rich-result eligibility rules (product decision) and does NOT
 * write to WordPress.
 */

import * as cheerio from 'cheerio';
import { isKnownSchemaType } from './schema-types';

export type SchemaSource = 'yoast' | 'poirier' | 'plugin' | 'unknown';
export type SchemaValidity = 'valid' | 'warnings' | 'errors';

export interface SchemaIssue {
  severity: 'error' | 'warning';
  /** Dotted path to the offending property, e.g. "@type" or "address". */
  path: string;
  message: string;
}

export interface DetectedSchema {
  /** Order of the owning <script> block in the document. */
  scriptIndex: number;
  /** Order within a @graph (0 when the block is a single node). */
  nodeIndex: number;
  /** Display form of @type (array types are joined with ", "). */
  type: string;
  source: SchemaSource;
  validity: SchemaValidity;
  issues: SchemaIssue[];
  /** The parsed JSON-LD node (kept so the UI can render / edit it). */
  json: unknown;
}

export interface SchemaParseError {
  scriptIndex: number;
  message: string;
  /** First chars of the offending block, to help locate it. */
  snippet: string;
}

export interface SchemaDetectionResult {
  schemas: DetectedSchema[];
  parseErrors: SchemaParseError[];
  summary: {
    total: number;
    valid: number;
    warnings: number;
    errors: number;
    bySource: Record<SchemaSource, number>;
  };
}

interface JsonLdBlock {
  scriptIndex: number;
  raw: string;
  className: string;
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** Pull every <script type="application/ld+json"> block out of the HTML. */
export function extractJsonLdBlocks(html: string): JsonLdBlock[] {
  const $ = cheerio.load(html);
  const blocks: JsonLdBlock[] = [];

  $('script[type="application/ld+json"]').each((scriptIndex, el) => {
    const $el = $(el);
    // .text() / .html() both work; .html() avoids cheerio entity-decoding the JSON.
    const raw = ($el.html() ?? '').trim();
    blocks.push({
      scriptIndex,
      raw,
      className: ($el.attr('class') ?? '').toLowerCase(),
    });
  });

  return blocks;
}

/** Guess where a schema block came from. className is the only reliable signal. */
function inferSource(className: string, _node: unknown): SchemaSource {
  if (className.includes('yoast-schema-graph')) return 'yoast';
  if (className.includes('poirier')) return 'poirier';
  // Some plugins tag their output (e.g. "rank-math-schema", "aioseo-schema").
  if (className.includes('schema') || className.includes('seo')) return 'plugin';
  return 'unknown';
}

/** Human-readable @type ("Article", "LocalBusiness, Organization", "(no type)"). */
function displayType(node: Record<string, unknown>): string {
  const t = node['@type'];
  if (typeof t === 'string') return t;
  if (Array.isArray(t)) {
    const parts = t.filter((x): x is string => typeof x === 'string');
    return parts.length ? parts.join(', ') : '(no type)';
  }
  return '(no type)';
}

/** Validate a single flattened JSON-LD node against schema.org structure. */
function validateNode(
  node: unknown,
  hasContext: boolean,
): { issues: SchemaIssue[] } {
  const issues: SchemaIssue[] = [];

  if (!isPlainObject(node)) {
    issues.push({
      severity: 'error',
      path: '',
      message: 'Schema node is not a JSON object.',
    });
    return { issues };
  }

  if (Object.keys(node).length === 0) {
    issues.push({ severity: 'error', path: '', message: 'Empty schema node.' });
    return { issues };
  }

  // @context: required on the block; @graph children inherit it from the wrapper.
  if (!hasContext) {
    issues.push({
      severity: 'warning',
      path: '@context',
      message: 'Missing "@context": should reference https://schema.org.',
    });
  }

  // @type
  const type = node['@type'];
  const typeStrings: string[] = [];
  if (type === undefined || type === null) {
    issues.push({
      severity: 'error',
      path: '@type',
      message: 'Missing "@type".',
    });
  } else if (typeof type === 'string') {
    typeStrings.push(type);
  } else if (Array.isArray(type)) {
    for (const t of type) {
      if (typeof t === 'string') typeStrings.push(t);
      else
        issues.push({
          severity: 'error',
          path: '@type',
          message: 'Each entry in "@type" must be a string.',
        });
    }
  } else {
    issues.push({
      severity: 'error',
      path: '@type',
      message: '"@type" must be a string or an array of strings.',
    });
  }

  for (const t of typeStrings) {
    if (!isKnownSchemaType(t)) {
      issues.push({
        severity: 'warning',
        path: '@type',
        message: `Unrecognised schema.org type: "${t}".`,
      });
    }
  }

  return { issues };
}

function validityOf(issues: SchemaIssue[]): SchemaValidity {
  if (issues.some((i) => i.severity === 'error')) return 'errors';
  if (issues.some((i) => i.severity === 'warning')) return 'warnings';
  return 'valid';
}

/**
 * Detect and validate every JSON-LD schema on a page's HTML.
 * Flattens @graph wrappers and top-level arrays into individual nodes.
 */
export function detectSchemas(html: string): SchemaDetectionResult {
  const blocks = html ? extractJsonLdBlocks(html) : [];
  const schemas: DetectedSchema[] = [];
  const parseErrors: SchemaParseError[] = [];

  for (const block of blocks) {
    if (!block.raw) {
      parseErrors.push({
        scriptIndex: block.scriptIndex,
        message: 'Empty JSON-LD block.',
        snippet: '',
      });
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(block.raw);
    } catch (err) {
      parseErrors.push({
        scriptIndex: block.scriptIndex,
        message: `Invalid JSON: ${(err as Error).message}`,
        snippet: block.raw.slice(0, 120),
      });
      continue;
    }

    const source = inferSource(block.className, parsed);

    // A block can be a single node, an array of nodes, or a {@graph:[...]} wrapper.
    // When the @context lives on the wrapper (Yoast's pattern), flattened nodes
    // would lose it — so we propagate it onto each node, making every stored
    // schema self-contained and valid on its own.
    let nodes: unknown[];
    let wrapperContext: unknown;
    if (isPlainObject(parsed) && Array.isArray(parsed['@graph'])) {
      if ('@context' in parsed) wrapperContext = parsed['@context'];
      nodes = parsed['@graph'] as unknown[];
    } else if (Array.isArray(parsed)) {
      nodes = parsed;
    } else {
      nodes = [parsed];
    }

    nodes.forEach((node, nodeIndex) => {
      // Inject the wrapper @context when the node lacks its own.
      const json =
        isPlainObject(node) && !('@context' in node) && wrapperContext !== undefined
          ? { '@context': wrapperContext, ...node }
          : node;
      const nodeHasContext = isPlainObject(json) && '@context' in json;
      const { issues } = validateNode(json, nodeHasContext);
      schemas.push({
        scriptIndex: block.scriptIndex,
        nodeIndex,
        type: isPlainObject(json) ? displayType(json) : '(invalid)',
        source,
        validity: validityOf(issues),
        issues,
        json,
      });
    });
  }

  const bySource: Record<SchemaSource, number> = {
    yoast: 0,
    poirier: 0,
    plugin: 0,
    unknown: 0,
  };
  let valid = 0;
  let warnings = 0;
  let errors = 0;
  for (const s of schemas) {
    bySource[s.source]++;
    if (s.validity === 'valid') valid++;
    else if (s.validity === 'warnings') warnings++;
    else errors++;
  }

  return {
    schemas,
    parseErrors,
    summary: { total: schemas.length, valid, warnings, errors, bySource },
  };
}

export interface JsonLdValidation {
  /** Parsed as JSON (false → see parseError). */
  ok: boolean;
  parseError: string | null;
  nodes: { type: string; validity: SchemaValidity; issues: SchemaIssue[] }[];
  /** Worst validity across all nodes ('errors' when parse failed). */
  validity: SchemaValidity;
}

/** Validate one already-parsed JSON-LD value (object / array / @graph wrapper). */
export function validateJsonLdValue(parsed: unknown): JsonLdValidation {
  let nodes: unknown[];
  let contextOnWrapper = false;
  if (isPlainObject(parsed) && Array.isArray(parsed['@graph'])) {
    contextOnWrapper = '@context' in parsed;
    nodes = parsed['@graph'] as unknown[];
  } else if (Array.isArray(parsed)) {
    nodes = parsed;
  } else {
    nodes = [parsed];
  }

  const out = nodes.map((node) => {
    const nodeHasContext =
      contextOnWrapper || (isPlainObject(node) && '@context' in node);
    const { issues } = validateNode(node, nodeHasContext);
    return {
      type: isPlainObject(node) ? displayType(node) : '(invalid)',
      validity: validityOf(issues),
      issues,
    };
  });

  const validity: SchemaValidity = out.some((n) => n.validity === 'errors')
    ? 'errors'
    : out.some((n) => n.validity === 'warnings')
      ? 'warnings'
      : 'valid';

  return { ok: true, parseError: null, nodes: out, validity };
}

/** Validate a JSON-LD string — parses first (for the live editor / proposals). */
export function validateJsonLd(raw: string): JsonLdValidation {
  if (!raw || !raw.trim()) {
    return { ok: false, parseError: 'Empty input.', nodes: [], validity: 'errors' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return {
      ok: false,
      parseError: `Invalid JSON: ${(err as Error).message}`,
      nodes: [],
      validity: 'errors',
    };
  }
  return validateJsonLdValue(parsed);
}
