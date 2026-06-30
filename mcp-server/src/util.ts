/**
 * Output-shaping helpers. Every tool returns BOTH a concise human-readable text
 * summary AND structured JSON, while aggressively trimming oversized payloads
 * (never dump rawHtml; cap arrays; truncate long strings) so results stay
 * LLM-friendly and cheap.
 */
import type { PageLite } from './cms-client.js';

/** Keys we always drop from page-like objects before returning them. */
const HEAVY_KEYS = ['rawHtml', 'cleanContent', 'contentStructure', 'embedding'];

/** Strip heavy fields and truncate any remaining long strings. */
export function slimPage<T extends Record<string, any>>(page: T): Partial<T> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(page)) {
    if (HEAVY_KEYS.includes(k)) continue;
    out[k] = typeof v === 'string' ? truncate(v, 500) : v;
  }
  return out as Partial<T>;
}

export function truncate(s: string, max = 300): string {
  if (s == null) return s;
  return s.length > max ? `${s.slice(0, max)}… [+${s.length - max} chars]` : s;
}

/** A short one-line meta summary for a page (for list views). */
export function pageMetaSummary(p: PageLite): string {
  const title = p.customMetaTitle ?? p.metaTitle ?? '(no title)';
  const idx =
    p.indexDirective && p.indexDirective !== 'default'
      ? p.indexDirective
      : p.noindex
        ? 'noindex'
        : 'index(default)';
  const flags = [idx, p.nofollow ? 'nofollow' : null, p.syncStatus]
    .filter(Boolean)
    .join(', ');
  return `${p.url}  —  "${truncate(title, 80)}"  [${flags}]`;
}

/**
 * The standard MCP tool result shape used across all tools. The index signature
 * keeps it structurally assignable to the SDK's CallToolResult type.
 */
export interface ToolResult {
  [key: string]: unknown;
  content: { type: 'text'; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
}

/** Success result: human text + structured JSON. */
export function ok(
  text: string,
  structured?: Record<string, unknown>,
): ToolResult {
  return {
    content: [{ type: 'text', text }],
    ...(structured ? { structuredContent: structured } : {}),
  };
}

/** Error result: surfaces the message as text and flags isError. */
export function fail(message: string): ToolResult {
  return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
}

/** Wrap a tool handler so thrown errors become clean isError results. */
export function guard(
  fn: () => Promise<ToolResult>,
): Promise<ToolResult> {
  return fn().catch((e: unknown) => fail((e as Error)?.message || String(e)));
}

/** Compact JSON.stringify with a hard size cap (defensive). */
export function jsonCap(value: unknown, maxChars = 20_000): string {
  let s: string;
  try {
    s = JSON.stringify(value, null, 2);
  } catch {
    s = String(value);
  }
  return s.length > maxChars ? `${s.slice(0, maxChars)}\n… [truncated]` : s;
}
