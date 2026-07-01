import { createHmac, timingSafeEqual } from 'crypto';

/** A task-scoped Asana webhook event, reduced to what the mirror needs. */
export interface TaskEvent {
  gid: string;
  deleted: boolean;
}

/**
 * Pull the task-scoped events out of an Asana webhook body. Non-task events
 * (sections, projects, etc.) are ignored — we only reconcile tracked tasks.
 * Pure — unit tested.
 */
export function extractTaskEvents(body: unknown): TaskEvent[] {
  const events = (body as { events?: unknown[] })?.events;
  if (!Array.isArray(events)) return [];
  const out: TaskEvent[] = [];
  for (const e of events) {
    const resource = (e as { resource?: { gid?: string; resource_type?: string } })?.resource;
    const action = (e as { action?: string })?.action;
    if (resource?.resource_type === 'task' && resource.gid) {
      out.push({ gid: String(resource.gid), deleted: action === 'deleted' });
    }
  }
  return out;
}

/**
 * Asana signs each webhook delivery with `X-Hook-Signature` =
 * HMAC-SHA256(rawBody, secret) as lowercase hex, where `secret` is the value
 * from the establishment handshake (`X-Hook-Secret`). Pure — unit tested.
 */
export function computeHookSignature(rawBody: Buffer | string, secret: string): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

/**
 * Constant-time verify of an Asana `X-Hook-Signature`. Returns false for a
 * missing signature/secret or a length mismatch, without leaking timing on the
 * compare itself.
 */
export function verifyHookSignature(
  rawBody: Buffer | string,
  signature: string | null | undefined,
  secret: string | null | undefined,
): boolean {
  if (!signature || !secret) return false;
  const expected = computeHookSignature(rawBody, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
