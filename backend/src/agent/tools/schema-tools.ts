import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { SchemaService } from '../../schema/schema.service';
import { SchemaAiService } from '../../schema/schema-ai.service';
import { SchemaSyncService } from '../../schema/schema-sync.service';
import { SchemaQcService } from '../../schema/schema-qc.service';

/**
 * Agent tools for the JSON-LD schema module. Built exactly like
 * `createProposalTools`: a factory returning AI-SDK tools that wrap the
 * EXISTING schema services (no new business logic lives here).
 *
 * Three result shapes (mirrors the proposal-tools convention):
 *  - READ tools execute the service and return its data so the model can reason
 *    over it (and the UI renders it as a generic tool card).
 *  - GENERATION (`analyzeSchemas`) returns `{ type: 'schema_proposal', … }` so the
 *    UI shows reviewable add/fix/drift proposal cards (Approve/Edit/Reject).
 *  - MUTATIONS that are additive (`addManagedSchema`, `editManagedSchema`) execute
 *    directly and return `{ type: 'schema_result', … }`.
 *  - DESTRUCTIVE actions (`removeManagedSchema`, `applySchemas`, `unpublishSchemas`)
 *    DO NOT execute — they return `{ type: 'schema_confirm', … }` so the UI renders
 *    a confirmation card the user must click (Apply/Confirm), exactly like briefs.
 *
 * `pageId` is required for page-scoped tools. When the assistant runs on a schema
 * detail page the active pageId is injected via the system prompt, so the model
 * can call these without the user re-stating it.
 */
export function createSchemaTools(
  schemaService: SchemaService,
  schemaAiService: SchemaAiService,
  schemaSyncService: SchemaSyncService,
  schemaQcService: SchemaQcService,
  siteId: string,
) {
  return {
    // ── READ ────────────────────────────────────────────────────────────────
    listPageSchemas: tool({
      description:
        'List the managed JSON-LD schemas for a page (the current CMS set, including ' +
        'modified/removed rows pending Apply). Call this to see what schemas exist before editing.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().describe('The page ID whose managed schemas to list'),
        }),
      ),
      execute: async (args: { pageId: string }) => {
        const schemas = await schemaService.listManaged(args.pageId);
        return {
          type: 'schema_data',
          action: 'list_managed',
          pageId: args.pageId,
          schemas,
        };
      },
    }),

    detectSchemas: tool({
      description:
        'Re-run JSON-LD detection + validation against the page\'s stored HTML and ' +
        'persist the result. Detected nodes are auto-adopted into the managed set as the ' +
        'live baseline. Use when the user asks to detect / re-check structured data.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().describe('The page ID to detect schemas on'),
        }),
      ),
      execute: async (args: { pageId: string }) => {
        const result = await schemaService.detectForPage(args.pageId);
        return {
          type: 'schema_data',
          action: 'detect',
          pageId: args.pageId,
          result,
        };
      },
    }),

    getSchemaValidation: tool({
      description:
        'Validate an arbitrary JSON-LD object (schema.org STRUCTURAL validation only). ' +
        'Use to check a schema the user pasted or one you intend to propose before proposing it.',
      inputSchema: zodSchema(
        z.object({
          jsonld: z
            .string()
            .describe('The JSON-LD to validate, as a STRING (single valid JSON object).'),
        }),
      ),
      execute: async (args: { jsonld: string }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.jsonld);
        } catch (err) {
          return {
            type: 'schema_data',
            action: 'validate',
            validation: {
              ok: false,
              parseError: (err as Error).message,
              nodes: [],
              validity: 'errors' as const,
            },
          };
        }
        return {
          type: 'schema_data',
          action: 'validate',
          validation: schemaService.validate(parsed),
        };
      },
    }),

    getPendingSchemaChanges: tool({
      description:
        'Get how many managed schema rows are pending Apply (added/edited/deleted) for a page.',
      inputSchema: zodSchema(
        z.object({ pageId: z.string().describe('The page ID') }),
      ),
      execute: async (args: { pageId: string }) => ({
        type: 'schema_data',
        action: 'pending',
        pageId: args.pageId,
        ...(await schemaService.pendingChanges(args.pageId)),
      }),
    }),

    getSchemaHistory: tool({
      description:
        'Get the immutable history of published schema snapshots for a page (audit trail).',
      inputSchema: zodSchema(
        z.object({ pageId: z.string().describe('The page ID') }),
      ),
      execute: async (args: { pageId: string }) => ({
        type: 'schema_data',
        action: 'history',
        pageId: args.pageId,
        history: await schemaSyncService.getHistory(args.pageId),
      }),
    }),

    runSchemaQc: tool({
      description:
        'Run a QC reconciliation for a page: compares the CMS managed set ↔ what the WP ' +
        'plugin has stored ↔ what is actually rendered live. Use for "is my schema live / in sync?".',
      inputSchema: zodSchema(
        z.object({ pageId: z.string().describe('The page ID') }),
      ),
      execute: async (args: { pageId: string }) => ({
        type: 'schema_data',
        action: 'qc',
        pageId: args.pageId,
        report: await schemaQcService.qc(siteId, args.pageId),
      }),
    }),

    // ── GENERATION (proposals) ────────────────────────────────────────────────
    analyzeSchemas: tool({
      description:
        'Run the grounded AI schema analysis for a page. Returns add/fix/drift proposals ' +
        '(grounded against the page content + Brand Card, never fabricating ratings/reviews). ' +
        'Use this for "generate schema", "suggest structured data", "fix my schema", "find schema gaps". ' +
        'Each proposal is reviewable by the user — do NOT also paste the JSON-LD as chat text.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().describe('The page ID to analyze'),
        }),
      ),
      execute: async (args: { pageId: string }) => {
        const { proposals } = await schemaAiService.analyze(siteId, args.pageId);
        return {
          type: 'schema_proposal',
          action: 'schema_proposals',
          pageId: args.pageId,
          siteId,
          proposals,
        };
      },
    }),

    // ── ADDITIVE MUTATIONS (execute) ──────────────────────────────────────────
    addManagedSchema: tool({
      description:
        'Add a NEW managed JSON-LD schema to a page (counts as a pending change until Apply). ' +
        'Use after the user approves a proposal or asks to add a specific schema. ' +
        'PREREQUISITE: you must have called listPageSchemas first and confirmed the page has ' +
        'NO managed schema of this @type. If one of the same @type already exists, do NOT add a ' +
        'duplicate — use editManagedSchema on the existing row, or ask the user whether to edit it ' +
        'or add a separate one. jsonld must be a single valid JSON object string.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().describe('The page ID'),
          type: z.string().describe('The schema.org @type, e.g. "FAQPage"'),
          jsonld: z.string().describe('The JSON-LD object as a STRING'),
          rationale: z
            .string()
            .nullable()
            .describe('Why this schema is being added (optional)'),
        }),
      ),
      execute: async (args: {
        pageId: string;
        type: string;
        jsonld: string;
        rationale: string | null;
      }) => {
        let parsed: unknown;
        try {
          parsed = JSON.parse(args.jsonld);
        } catch (err) {
          return {
            type: 'schema_result',
            action: 'schema_add_failed',
            error: `Invalid JSON: ${(err as Error).message}`,
          };
        }
        // Duplicate guard: never silently create a second schema of a @type the
        // page already manages. Surface the existing row so the model edits it
        // (or asks the user) instead of producing a duplicate.
        const existing = await schemaService.listManaged(args.pageId);
        const dup = existing.find(
          (s) =>
            s.status !== 'removed' &&
            s.type?.toLowerCase() === args.type?.toLowerCase(),
        );
        if (dup) {
          return {
            type: 'schema_result',
            action: 'schema_add_blocked_duplicate',
            schemaId: dup.id,
            schemaType: dup.type,
            error:
              `This page already has a managed "${dup.type}" schema (id ${dup.id}). ` +
              `Do not add a duplicate. To change it, call editManagedSchema with schemaId "${dup.id}". ` +
              `If the user might want a separate additional schema instead of editing, ask them which they want.`,
          };
        }
        const row = await schemaService.createManaged(siteId, args.pageId, {
          type: args.type,
          jsonld: parsed,
          aiRationale: args.rationale,
        });
        return {
          type: 'schema_result',
          action: 'schema_added',
          pageId: args.pageId,
          schemaId: row.id,
          schemaType: row.type,
          validationStatus: row.validationStatus,
        };
      },
    }),

    editManagedSchema: tool({
      description:
        'Edit an existing managed schema (by id). Any JSON-LD change marks the row pending ' +
        'until Apply. Use when the user asks to tweak a specific schema.',
      inputSchema: zodSchema(
        z.object({
          schemaId: z.string().describe('The managed schema row id to edit'),
          type: z.string().nullable().describe('New @type, null to keep'),
          jsonld: z
            .string()
            .nullable()
            .describe('New JSON-LD object as a STRING, null to keep'),
        }),
      ),
      execute: async (args: {
        schemaId: string;
        type: string | null;
        jsonld: string | null;
      }) => {
        let parsed: unknown;
        if (args.jsonld != null) {
          try {
            parsed = JSON.parse(args.jsonld);
          } catch (err) {
            return {
              type: 'schema_result',
              action: 'schema_edit_failed',
              error: `Invalid JSON: ${(err as Error).message}`,
            };
          }
        }
        const row = await schemaService.updateManaged(args.schemaId, {
          ...(args.type != null ? { type: args.type } : {}),
          ...(args.jsonld != null ? { jsonld: parsed } : {}),
        });
        return {
          type: 'schema_result',
          action: 'schema_edited',
          schemaId: row.id,
          schemaType: row.type,
          validationStatus: row.validationStatus,
        };
      },
    }),

    // ── DESTRUCTIVE (confirmation cards — do NOT execute server-side) ──────────
    removeManagedSchema: tool({
      description:
        'Request removal of a managed schema. This DOES NOT delete immediately — it returns a ' +
        'confirmation card the user must click to confirm. Use when the user asks to delete a schema.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().describe('The page ID the schema belongs to'),
          schemaId: z.string().describe('The managed schema row id to remove'),
          schemaType: z
            .string()
            .nullable()
            .describe('The schema @type, for display on the confirmation card'),
        }),
      ),
      execute: async (args: {
        pageId: string;
        schemaId: string;
        schemaType: string | null;
      }) => ({
        type: 'schema_confirm',
        action: 'remove_schema',
        siteId,
        pageId: args.pageId,
        schemaId: args.schemaId,
        schemaType: args.schemaType,
      }),
    }),

    applySchemas: tool({
      description:
        'Request applying (publishing) all pending schema changes for a page to WordPress. ' +
        'This is a DESTRUCTIVE/external action — it returns a confirmation card the user must ' +
        'click to confirm. Use when the user asks to apply / publish schema changes.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().describe('The page ID to apply pending changes for'),
        }),
      ),
      execute: async (args: { pageId: string }) => {
        const { pending } = await schemaService.pendingChanges(args.pageId);
        return {
          type: 'schema_confirm',
          action: 'apply_schemas',
          siteId,
          pageId: args.pageId,
          pending,
        };
      },
    }),

    unpublishSchemas: tool({
      description:
        'Request removing ALL CMS schemas from WordPress for a page (unpublish). ' +
        'DESTRUCTIVE — returns a confirmation card the user must click. Use when the user asks ' +
        'to unpublish / remove schemas from the live site.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().describe('The page ID to unpublish'),
        }),
      ),
      execute: async (args: { pageId: string }) => ({
        type: 'schema_confirm',
        action: 'unpublish_schemas',
        siteId,
        pageId: args.pageId,
      }),
    }),
  };
}
