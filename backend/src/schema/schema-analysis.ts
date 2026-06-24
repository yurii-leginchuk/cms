/**
 * Pure helpers for the AI schema-analysis pass (Phase 2).
 *
 * Grounding reuses the SEO agent's `checkFaithfulness` ([[project_ai_grounding]]):
 * every value the model puts in a schema must trace to the page content or the
 * Brand Card. neverSay hits are a HARD fail; ungrounded values are surfaced as
 * `unverifiedClaims` (a banner the human resolves) — never silently shipped.
 */

import { randomUUID } from 'crypto';
import {
  checkFaithfulness,
  GroundingContext,
} from '../agent/tools/proposal-validation';
import {
  validateJsonLdValue,
  SchemaIssue,
  SchemaValidity,
} from './schema-validator';

export type SchemaProposalKind = 'add' | 'fix' | 'drift';

/** What the model returns per proposal (before server-side grounding). */
export interface RawSchemaProposal {
  kind: SchemaProposalKind;
  type: string;
  jsonld: unknown;
  rationale?: string;
  evidence?: string[];
  /** For fix/drift: which detected block this targets. */
  targetScriptIndex?: number | null;
  targetNodeIndex?: number | null;
  /** For fix/drift on a CMS-managed schema (the source of truth, may not be
   * live yet): the managed row id this proposal improves/replaces. */
  targetManagedId?: string | null;
}

/** A grounded, validated proposal ready for human review. */
export interface SchemaProposal {
  id: string;
  kind: SchemaProposalKind;
  type: string;
  jsonld: unknown;
  rationale: string;
  evidence: string[];
  unverifiedClaims: string[];
  /** True when a Brand Card neverSay term appears — hard faithfulness fail. */
  forbidden: boolean;
  validation: { validity: SchemaValidity; issues: SchemaIssue[] };
  targetScriptIndex: number | null;
  targetNodeIndex: number | null;
  /** Set when the proposal improves an existing CMS-managed schema. */
  targetManagedId: string | null;
  before: unknown | null;
  /** Deterministic, server-computed summary of what actually changes vs
   * `before` (fix/drift only) — the trustworthy diff, independent of the
   * model's prose rationale. Empty when nothing structural changed. */
  changeSummary: string[];
}

function isPlainObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** One schema entry the model is shown (managed or detected-on-page). */
export interface SchemaBlockEntry {
  /** Compact label shown to the model (e.g. managedId / scriptIndex). */
  label: Record<string, unknown>;
  /** The raw JSON-LD object for this schema. */
  json: unknown;
}

/**
 * Serialize a set of schemas for the prompt — every schema is shown IN FULL, one
 * per line as `{label} {compact-json}`. No truncation: the model must always see
 * the complete existing schemas (to count edits correctly and to honour the
 * DEDUP rule), and compact JSON (no pretty-print) keeps it token-lean without
 * dropping content.
 *
 * This replaces the previous `JSON.stringify(all, null, 2).slice(0, N)`, which
 * truncated the LAST schema(s) out of the prompt entirely once the combined
 * pretty-printed blob exceeded N — making the model miscount edits to a schema
 * it never actually saw.
 */
export function buildSchemaBlock(entries: SchemaBlockEntry[]): string {
  if (entries.length === 0) return '';
  return entries
    .map((e) => `${JSON.stringify(e.label)} ${JSON.stringify(e.json)}`)
    .join('\n');
}

/**
 * Deterministic diff between the current (`before`) and proposed schema —
 * honest, model-independent. Reports added/removed top-level properties and,
 * for array properties (e.g. FAQ mainEntity), the item-count delta. `@`-keys
 * (@type/@context/@id plumbing) are ignored.
 */
export function summarizeChange(before: unknown, after: unknown): string[] {
  if (before == null || after == null) return [];
  if (!isPlainObj(before) || !isPlainObj(after)) {
    return JSON.stringify(before) === JSON.stringify(after)
      ? []
      : ['Content changed'];
  }
  const out: string[] = [];
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  for (const k of keys) {
    if (k.startsWith('@')) continue;
    const inB = k in before;
    const inA = k in after;
    if (inA && !inB) {
      out.push(`Added "${k}"`);
      continue;
    }
    if (inB && !inA) {
      out.push(`Removed "${k}"`);
      continue;
    }
    const b = before[k];
    const a = after[k];
    if (Array.isArray(b) && Array.isArray(a)) {
      if (a.length !== b.length) {
        const d = a.length - b.length;
        out.push(
          `"${k}": ${b.length} → ${a.length} item${a.length === 1 ? '' : 's'} (${d > 0 ? '+' : ''}${d})`,
        );
      } else if (JSON.stringify(b) !== JSON.stringify(a)) {
        out.push(`"${k}": items edited`);
      }
    } else if (JSON.stringify(b) !== JSON.stringify(a)) {
      out.push(`"${k}" changed`);
    }
  }
  return out;
}

/** Recursively collect every string value in a JSON-LD object into one blob. */
export function jsonldToText(value: unknown): string {
  const out: string[] = [];
  const walk = (v: unknown) => {
    if (typeof v === 'string') out.push(v);
    else if (typeof v === 'number' || typeof v === 'boolean') out.push(String(v));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') {
      for (const [k, val] of Object.entries(v)) {
        if (k.startsWith('@')) continue; // skip @type/@id/@context plumbing
        walk(val);
      }
    }
  };
  walk(value);
  return out.join(' ');
}

/** Build the faithfulness grounding context from page content + Brand Card facts. */
export function buildGroundingContext(
  pageContent: string | null,
  brand: {
    brandName?: string | null;
    services?: { name: string; subServices?: string[] }[];
    locations?: string[];
    people?: { name: string }[];
    approvedClaims?: string[];
    neverSay?: string[];
  } | null,
): GroundingContext {
  const brandServices: string[] = [];
  if (brand) {
    if (brand.brandName) brandServices.push(brand.brandName);
    for (const s of brand.services ?? []) {
      brandServices.push(s.name, ...(s.subServices ?? []));
    }
    brandServices.push(...(brand.locations ?? []));
    brandServices.push(...(brand.people ?? []).map((p) => p.name));
    brandServices.push(...(brand.approvedClaims ?? []));
  }
  return {
    sourceContent: pageContent ?? '',
    retrievedContent: [],
    brandServices: brandServices.filter(Boolean),
    brandNeverSay: brand?.neverSay ?? [],
  };
}

/** Validate + faithfulness-check one raw proposal into a review-ready proposal. */
export function groundProposal(
  raw: RawSchemaProposal,
  ctx: GroundingContext,
  before: unknown | null = null,
): SchemaProposal {
  const text = `${jsonldToText(raw.jsonld)} ${raw.rationale ?? ''}`;
  const faith = checkFaithfulness(text, ctx);
  const v = validateJsonLdValue(raw.jsonld);

  const unverifiedClaims = [
    ...faith.forbiddenHits.map((t) => `Forbidden (Brand Card neverSay): "${t}"`),
    ...faith.unsupportedOfferings,
  ];

  return {
    id: randomUUID(),
    kind: raw.kind,
    type: raw.type || '(no type)',
    jsonld: raw.jsonld,
    rationale: raw.rationale ?? '',
    evidence: Array.isArray(raw.evidence) ? raw.evidence : [],
    unverifiedClaims,
    forbidden: !faith.faithful,
    validation: { validity: v.validity, issues: v.nodes.flatMap((n) => n.issues) },
    targetScriptIndex: raw.targetScriptIndex ?? null,
    targetNodeIndex: raw.targetNodeIndex ?? null,
    targetManagedId: raw.targetManagedId ?? null,
    before,
    changeSummary: raw.kind === 'add' ? [] : summarizeChange(before, raw.jsonld),
  };
}
