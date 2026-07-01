import { verifyWebhookSecret } from './webhook-auth';

describe('verifyWebhookSecret (constant-time)', () => {
  it('accepts an exact match', () => {
    expect(verifyWebhookSecret('s3cr3t-abc', 's3cr3t-abc')).toBe(true);
  });
  it('rejects a wrong secret of the same length', () => {
    expect(verifyWebhookSecret('s3cr3t-abc', 's3cr3t-xyz')).toBe(false);
  });
  it('rejects a length mismatch without throwing', () => {
    expect(verifyWebhookSecret('short', 'a-much-longer-secret')).toBe(false);
  });
  it('rejects missing/empty secrets', () => {
    expect(verifyWebhookSecret(undefined, 'stored')).toBe(false);
    expect(verifyWebhookSecret('provided', null)).toBe(false);
    expect(verifyWebhookSecret('', '')).toBe(false);
  });
});
