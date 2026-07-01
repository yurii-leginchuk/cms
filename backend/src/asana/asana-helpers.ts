/**
 * Pure Asana helpers — no I/O, fully unit-tested.
 *   - shouldRetry / nextBackoffMs : 429 + 5xx backoff policy for the API client.
 *   - mapAsanaError               : HTTP status → a specific, SECRET-FREE human
 *                                   reason (never leaks the token or raw body).
 *   - collectPaginated            : follow Asana's opaque `next_page.offset`.
 *   - deriveSection / mapTaskToMirror : map an Asana task payload onto our mirror
 *                                   row (section = the task's status column).
 */

/** Retry only transient failures (rate limit + server errors), capped. */
export function shouldRetry(status: number, attempt: number, maxRetries: number): boolean {
  if (attempt >= maxRetries) return false;
  return status === 429 || (status >= 500 && status <= 599);
}

/**
 * Backoff for the next attempt. Honors Asana's `Retry-After` (seconds) when
 * present; otherwise exponential 500ms·2^attempt, capped at 30s.
 */
export function nextBackoffMs(attempt: number, retryAfter?: string | number | null): number {
  const ra = typeof retryAfter === 'string' ? parseInt(retryAfter, 10) : retryAfter;
  if (ra != null && Number.isFinite(ra) && ra >= 0) {
    return Math.min(ra * 1000, 60_000);
  }
  return Math.min(500 * Math.pow(2, attempt), 30_000);
}

/** Map an Asana HTTP error to a specific, secret-free human reason. */
export function mapAsanaError(status?: number, message?: string): string {
  if (status === 401) {
    return 'Asana rejected the token (unauthorized) — the Personal Access Token is invalid or was revoked.';
  }
  if (status === 403) {
    return 'Asana denied access — the token lacks permission for this resource.';
  }
  if (status === 404) {
    return 'Asana resource not found — it may have been deleted, or the GID is wrong.';
  }
  if (status === 429) {
    return 'Asana rate limit hit — too many requests. Try again shortly.';
  }
  if (status === 400) {
    const detail = message ? `: ${message.slice(0, 120)}` : '';
    return `Asana rejected the request${detail}.`;
  }
  if (status && status >= 500) {
    return 'Asana is having trouble (server error). Try again shortly.';
  }
  return 'Could not reach Asana — check connectivity.';
}

/** One page of an Asana list response (the `{ data, next_page }` envelope). */
export interface AsanaPage<T> {
  data: T[];
  next_page?: { offset: string } | null;
}

/**
 * Walk Asana's opaque-offset pagination, concatenating every page's `data`.
 * `maxPages` is a safety cap so a runaway project can't loop forever.
 */
export async function collectPaginated<T>(
  fetchPage: (offset?: string) => Promise<AsanaPage<T>>,
  maxPages = 50,
): Promise<T[]> {
  const out: T[] = [];
  let offset: string | undefined;
  for (let i = 0; i < maxPages; i++) {
    const page = await fetchPage(offset);
    if (Array.isArray(page.data)) out.push(...page.data);
    const next = page.next_page?.offset;
    if (!next) break;
    offset = next;
  }
  return out;
}

/**
 * Extract an Asana task GID from a pasted task URL (or a raw GID). Handles:
 *   - new format:  https://app.asana.com/1/{ws}/project/{proj}/task/{gid}[...]
 *   - new short:   https://app.asana.com/1/{ws}/task/{gid}
 *   - old format:  https://app.asana.com/0/{proj}/{gid}[/f]
 *   - a bare numeric GID.
 * Returns null when no plausible task id is present.
 */
export function parseAsanaTaskGid(input: string): string | null {
  const s = (input || '').trim();
  if (!s) return null;
  if (/^\d+$/.test(s)) return s;

  // Prefer an explicit .../task/{gid} segment (unambiguous).
  const explicit = s.match(/\/task\/(\d+)/);
  if (explicit) return explicit[1];

  // Otherwise take the last all-numeric path segment (old /0/{proj}/{gid}[/f]).
  try {
    const u = new URL(s);
    const segs = u.pathname.split('/').filter(Boolean);
    for (let i = segs.length - 1; i >= 0; i--) {
      if (/^\d+$/.test(segs[i])) return segs[i];
    }
  } catch {
    // not a URL — fall through to a last-ditch scan
  }
  const run = s.match(/(\d{6,})/);
  return run ? run[1] : null;
}

// ── Task payload → mirror row ────────────────────────────────────────────────

export interface AsanaMembership {
  project?: { gid: string } | null;
  section?: { gid: string; name: string } | null;
}

export interface AsanaTaskRaw {
  gid: string;
  name?: string;
  notes?: string;
  completed?: boolean;
  due_on?: string | null;
  permalink_url?: string;
  num_subtasks?: number;
  modified_at?: string;
  assignee?: { gid: string; name: string } | null;
  parent?: { gid: string } | null;
  memberships?: AsanaMembership[];
}

/**
 * The task's "status" is the board section it sits in. A task can belong to
 * several projects; pick the section from the membership matching OUR project,
 * falling back to any section so the column is never silently blank.
 */
export function deriveSection(
  memberships: AsanaMembership[] | undefined,
  projectGid: string,
): { gid: string; name: string } | null {
  if (!Array.isArray(memberships)) return null;
  const mine = memberships.find((m) => m.project?.gid === projectGid && m.section);
  if (mine?.section) return { gid: mine.section.gid, name: mine.section.name };
  const any = memberships.find((m) => m.section);
  return any?.section ? { gid: any.section.gid, name: any.section.name } : null;
}

export interface MirrorFields {
  siteId: string;
  projectGid: string;
  taskGid: string;
  name: string;
  notes: string | null;
  assigneeGid: string | null;
  assigneeName: string | null;
  sectionGid: string | null;
  sectionName: string | null;
  completed: boolean;
  dueOn: string | null;
  permalinkUrl: string | null;
  parentTaskGid: string | null;
  numSubtasks: number;
  asanaModifiedAt: Date | null;
  raw: unknown;
}

/** Map an Asana task payload onto the fields we mirror locally. Pure. */
export function mapTaskToMirror(
  raw: AsanaTaskRaw,
  siteId: string,
  projectGid: string,
): MirrorFields {
  const section = deriveSection(raw.memberships, projectGid);
  return {
    siteId,
    projectGid,
    taskGid: raw.gid,
    name: raw.name?.trim() || '(untitled task)',
    notes: raw.notes ?? null,
    assigneeGid: raw.assignee?.gid ?? null,
    assigneeName: raw.assignee?.name ?? null,
    sectionGid: section?.gid ?? null,
    sectionName: section?.name ?? null,
    completed: !!raw.completed,
    dueOn: raw.due_on ?? null,
    permalinkUrl: raw.permalink_url ?? null,
    parentTaskGid: raw.parent?.gid ?? null,
    numSubtasks: raw.num_subtasks ?? 0,
    asanaModifiedAt: raw.modified_at ? new Date(raw.modified_at) : null,
    raw,
  };
}
