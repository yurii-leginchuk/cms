/**
 * Schema (JSON-LD) tools.
 *
 * HUMAN APPROVAL GATE: schema_add / schema_update / schema_delete stage PENDING
 * proposals that a human must accept in the CMS (accept = applies the managed
 * change AND publishes to WordPress). The publish tools (schema_apply,
 * schema_apply_all) have been REMOVED — MCP never publishes. schema_analyze_ai
 * returns suggestions only (it does NOT persist).
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CmsClient } from '../cms-client.js';
import { guard, jsonCap, ok, truncate } from '../util.js';
import { pageIdField, pageUrlField, resolveTarget, siteIdField } from './shared.js';

/** Accept JSON-LD as an object/array OR a JSON string; return a parsed value. */
function coerceJsonld(input: unknown): unknown {
  if (typeof input === 'string') {
    try {
      return JSON.parse(input);
    } catch {
      throw new Error('jsonld was a string but is not valid JSON.');
    }
  }
  return input;
}

/** zod accepting object, array, or JSON string for a JSON-LD payload. */
const jsonldField = z
  .union([z.record(z.string(), z.any()), z.array(z.any()), z.string()])
  .describe('A JSON-LD object or array (or a JSON string of one).');

/** Summarise a managed/detected schema row without dumping full payloads. */
function summariseSchema(s: any) {
  return {
    id: s.id,
    type: s.type ?? s['@type'] ?? inferType(s.jsonld),
    status: s.status,
    source: s.source,
    valid: s.valid ?? s.validation?.valid,
    jsonldPreview: truncate(JSON.stringify(s.jsonld ?? s), 300),
  };
}

function inferType(jsonld: any): string | undefined {
  if (!jsonld) return undefined;
  if (Array.isArray(jsonld)) return jsonld.map((x) => x?.['@type']).filter(Boolean).join(',');
  return jsonld['@type'];
}

export function registerSchemaTools(server: McpServer, client: CmsClient) {
  const base = (siteId: string, pageId: string) =>
    `/sites/${siteId}/pages/${pageId}/schemas`;

  server.registerTool(
    'schema_list',
    {
      title: 'List managed schemas for a page',
      description:
        'Read-only: list the CMS-managed JSON-LD schemas for a page (id, type, status, source, validity, preview). Use the ids with schema_update / schema_delete.',
      inputSchema: { siteId: siteIdField, pageId: pageIdField, pageUrl: pageUrlField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const list = (await client.get(`${base(siteId, pageId)}/managed`)) as any[];
        const rows = (list || []).map(summariseSchema);
        return ok(
          `${rows.length} managed schema(s):\n` +
            rows.map((r) => `- [${r.id}] ${r.type ?? '?'} (${r.status}${r.valid === false ? ', INVALID' : ''})`).join('\n'),
          { schemas: rows },
        );
      }),
  );

  server.registerTool(
    'schema_get_detected',
    {
      title: 'Get last detected schemas for a page',
      description:
        'Read-only: return the last persisted detection result for the page (detected JSON-LD types + validity). Does NOT re-run detection — use schema_detect for that.',
      inputSchema: { siteId: siteIdField, pageId: pageIdField, pageUrl: pageUrlField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const res = (await client.get(base(siteId, pageId))) as any;
        return ok(summariseDetection(res), { detection: shapeDetection(res) });
      }),
  );

  server.registerTool(
    'schema_detect',
    {
      title: 'Re-detect schemas from stored HTML',
      description:
        'Re-detect + validate JSON-LD from the page\'s stored HTML (CMS-side only, no WordPress write). Returns detected types + validity.',
      inputSchema: { siteId: siteIdField, pageId: pageIdField, pageUrl: pageUrlField },
      annotations: { readOnlyHint: false, openWorldHint: false, idempotentHint: true },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const res = (await client.post(`${base(siteId, pageId)}/detect`)) as any;
        return ok(summariseDetection(res), { detection: shapeDetection(res) });
      }),
  );

  server.registerTool(
    'schema_reparse',
    {
      title: 'Re-fetch live page and re-detect schemas',
      description:
        'SIDE EFFECT (reads the LIVE site): re-fetch the live page HTML and re-detect schemas (use after publishing or external edits). Returns detected types + validity.',
      inputSchema: { siteId: siteIdField, pageId: pageIdField, pageUrl: pageUrlField },
      annotations: { readOnlyHint: false, openWorldHint: true, idempotentHint: true },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const res = (await client.post(`${base(siteId, pageId)}/reparse`)) as any;
        return ok(summariseDetection(res), { detection: shapeDetection(res) });
      }),
  );

  server.registerTool(
    'schema_validate',
    {
      title: 'Validate a JSON-LD snippet',
      description:
        'Read-only: validate a JSON-LD object/array against the CMS\'s schema.org-structural validator. No page or site needed. Returns validity + any errors.',
      inputSchema: {
        jsonld: jsonldField,
        siteId: siteIdField.describe('Optional; only used to address the validate endpoint (validation is page-independent).'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        // validate is page-independent; the handler ignores the path params.
        const siteId = args.siteId || client.defaultSiteId || '_';
        const res = (await client.post(`/sites/${siteId}/pages/_/schemas/validate`, {
          jsonld: coerceJsonld(args.jsonld),
        })) as any;
        // Three-state verdict: a recognised schema carrying only warnings is
        // still VALID (with warnings) — not INVALID. Parse errors are INVALID.
        const validity: string = res?.parseError
          ? 'invalid'
          : (res?.validity ?? (res?.ok ? 'valid' : 'invalid'));
        const label =
          validity === 'valid'
            ? 'VALID'
            : validity === 'warnings'
              ? 'VALID (with warnings)'
              : 'INVALID';
        const issues: string[] = [];
        if (res?.parseError) issues.push(`parseError: ${res.parseError}`);
        for (const n of res?.nodes ?? []) {
          for (const i of n.issues ?? []) {
            issues.push(`${n.type ?? '?'}: ${typeof i === 'string' ? i : i.message ?? JSON.stringify(i)}`);
          }
        }
        const types = (res?.nodes ?? []).map((n: any) => `${n.type}(${n.validity})`).join(', ');
        return ok(
          `Validation: ${label}${types ? ` — nodes: ${types}` : ''}${
            issues.length ? `\nIssues:\n- ${issues.slice(0, 20).join('\n- ')}` : ''
          }`,
          { validation: res },
        );
      }),
  );

  server.registerTool(
    'schema_add',
    {
      title: 'Propose adding a schema (needs human approval)',
      description:
        'Propose adding a JSON-LD schema to the page. Does NOT take effect immediately — stages a PENDING proposal a human must accept in the CMS (accept = adds the managed schema AND publishes to WordPress).',
      inputSchema: {
        siteId: siteIdField,
        pageId: pageIdField,
        pageUrl: pageUrlField,
        type: z.string().describe('Schema.org type, e.g. "FAQPage", "LocalBusiness".'),
        jsonld: jsonldField,
        source: z
          .enum(['human', 'ai_generated', 'ai_fixed', 'imported'])
          .optional()
          .describe('Origin of the schema (default human).'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const change = await client.createChange(siteId, {
          module: 'schema',
          action: 'schema.add',
          targetType: 'page',
          targetId: pageId,
          payload: {
            type: args.type,
            jsonld: coerceJsonld(args.jsonld),
            ...(args.source ? { source: args.source } : {}),
          },
        });
        return ok(
          `Proposed change #${change.id} — "${change.summary}" — awaiting human approval in the CMS.`,
          { proposal: change },
        );
      }),
  );

  server.registerTool(
    'schema_update',
    {
      title: 'Propose editing a schema (needs human approval)',
      description:
        'Propose editing an existing managed schema by id (type and/or jsonld). Does NOT take effect immediately — stages a PENDING proposal a human must accept (accept = applies the edit AND publishes to WordPress).',
      inputSchema: {
        siteId: siteIdField,
        pageId: pageIdField,
        pageUrl: pageUrlField,
        schemaId: z.string().describe('Managed schema id (from schema_list).'),
        type: z.string().optional(),
        jsonld: jsonldField.optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const payload: Record<string, unknown> = { schemaId: args.schemaId };
        if (args.type !== undefined) payload.type = args.type;
        if (args.jsonld !== undefined) payload.jsonld = coerceJsonld(args.jsonld);
        const change = await client.createChange(siteId, {
          module: 'schema',
          action: 'schema.update',
          targetType: 'page',
          targetId: pageId,
          payload,
        });
        return ok(
          `Proposed change #${change.id} — "${change.summary}" — awaiting human approval in the CMS.`,
          { proposal: change },
        );
      }),
  );

  server.registerTool(
    'schema_delete',
    {
      title: 'Propose deleting a schema (needs human approval)',
      description:
        'Propose deleting a managed schema by id. Does NOT take effect immediately — stages a PENDING proposal a human must accept (accept = removes the managed schema AND publishes the removal to WordPress).',
      inputSchema: {
        siteId: siteIdField,
        pageId: pageIdField,
        pageUrl: pageUrlField,
        schemaId: z.string().describe('Managed schema id (from schema_list).'),
      },
      annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const change = await client.createChange(siteId, {
          module: 'schema',
          action: 'schema.delete',
          targetType: 'page',
          targetId: pageId,
          payload: { schemaId: args.schemaId },
        });
        return ok(
          `Proposed change #${change.id} — "${change.summary}" — awaiting human approval in the CMS.`,
          { proposal: change },
        );
      }),
  );

  server.registerTool(
    'schema_analyze_ai',
    {
      title: 'AI-analyze schemas (suggestions only)',
      description:
        'COSTS AI TOKENS: run the grounded AI schema analysis — suggests new schema, fixes invalid schema, flags data drift. Returns suggestions only; it does NOT persist or publish. To apply a suggestion, call schema_add / schema_update (which stage a proposal for human approval).',
      inputSchema: { siteId: siteIdField, pageId: pageIdField, pageUrl: pageUrlField },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const res = (await client.post(`${base(siteId, pageId)}/analyze`)) as any;
        return ok(`AI schema analysis complete.\n${truncate(jsonCap(res, 4000), 2000)}`, {
          analysis: res,
        });
      }),
  );

  server.registerTool(
    'schema_qc',
    {
      title: 'QC reconcile schemas',
      description:
        'SIDE EFFECT (reads the LIVE site): reconcile managed ↔ plugin-stored ↔ live-rendered schema and report discrepancies. Read-mostly QC, no managed edits.',
      inputSchema: { siteId: siteIdField, pageId: pageIdField, pageUrl: pageUrlField },
      annotations: { readOnlyHint: false, openWorldHint: true },
    },
    async (args) =>
      guard(async () => {
        const { siteId, pageId } = await resolveTarget(client, args);
        const res = (await client.post(`${base(siteId, pageId)}/qc`)) as any;
        return ok(`Schema QC complete.\n${truncate(jsonCap(res, 4000), 2000)}`, { qc: res });
      }),
  );

  // ── Site-level (optional convenience) ───────────────────────────────────────
  server.registerTool(
    'schema_coverage',
    {
      title: 'Site schema coverage',
      description: 'Read-only: aggregate structured-data coverage across the site\'s pages.',
      inputSchema: { siteId: siteIdField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const siteId = client.resolveSiteId(args.siteId);
        const res = (await client.get(`/sites/${siteId}/schema/coverage`)) as any;
        return ok(`Schema coverage:\n${truncate(jsonCap(res, 3000), 1500)}`, { coverage: res });
      }),
  );
}

// ── detection summarising helpers ─────────────────────────────────────────────
function shapeDetection(res: any) {
  if (!res) return res;
  const schemas = res.schemas ?? res.detected ?? res.items;
  return {
    valid: res.valid ?? res.isValid ?? (res.validity ? res.validity === 'valid' : undefined),
    count: Array.isArray(schemas) ? schemas.length : undefined,
    types: Array.isArray(schemas)
      ? schemas.map((s: any) => s.type ?? s['@type'] ?? inferType(s.jsonld)).filter(Boolean)
      : undefined,
    errors: res.errors,
  };
}

function summariseDetection(res: any): string {
  const s = shapeDetection(res);
  if (!s || (s.count === undefined && s.types === undefined)) {
    return `Detection result:\n${truncate(jsonCap(res, 2000), 1000)}`;
  }
  return `Detected ${s.count ?? 0} schema(s): ${(s.types || []).join(', ') || '(none)'}${
    s.errors?.length ? `\nErrors: ${s.errors.slice(0, 10).join('; ')}` : ''
  }`;
}
