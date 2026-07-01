import { computeHookSignature, verifyHookSignature, extractTaskEvents } from './asana-webhook-auth';

describe('extractTaskEvents', () => {
  it('keeps only task events and flags deletions', () => {
    const body = {
      events: [
        { action: 'changed', resource: { gid: '1', resource_type: 'task' } },
        { action: 'added', resource: { gid: '2', resource_type: 'task' } },
        { action: 'deleted', resource: { gid: '3', resource_type: 'task' } },
        { action: 'changed', resource: { gid: '9', resource_type: 'section' } },
      ],
    };
    expect(extractTaskEvents(body)).toEqual([
      { gid: '1', deleted: false },
      { gid: '2', deleted: false },
      { gid: '3', deleted: true },
    ]);
  });
  it('returns [] for a bodyless / handshake payload', () => {
    expect(extractTaskEvents({})).toEqual([]);
    expect(extractTaskEvents(undefined)).toEqual([]);
    expect(extractTaskEvents({ events: null })).toEqual([]);
  });
});

describe('asana webhook signature', () => {
  const secret = 'super-secret-hook-value';
  const body = JSON.stringify({ events: [{ action: 'changed' }] });
  const sig = computeHookSignature(body, secret);

  it('computes a stable lowercase-hex HMAC-SHA256', () => {
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(computeHookSignature(body, secret)).toBe(sig);
  });

  it('verifies a correct signature', () => {
    expect(verifyHookSignature(body, sig, secret)).toBe(true);
    expect(verifyHookSignature(Buffer.from(body), sig, secret)).toBe(true);
  });

  it('rejects a wrong signature, wrong secret, or tampered body', () => {
    expect(verifyHookSignature(body, sig, 'other-secret')).toBe(false);
    expect(verifyHookSignature(body + ' ', sig, secret)).toBe(false);
    expect(verifyHookSignature(body, 'deadbeef', secret)).toBe(false);
  });

  it('rejects a missing signature or secret', () => {
    expect(verifyHookSignature(body, undefined, secret)).toBe(false);
    expect(verifyHookSignature(body, sig, null)).toBe(false);
    expect(verifyHookSignature(body, '', secret)).toBe(false);
  });
});
