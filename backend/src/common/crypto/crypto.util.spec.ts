import {
  encryptSecret,
  decryptSecret,
  loadKey,
  EncryptionKeyError,
} from './crypto.util';

// Deterministic 32-byte test keys (64 hex chars each).
const KEY_A = Buffer.from('11'.repeat(32), 'hex');
const KEY_B = Buffer.from('22'.repeat(32), 'hex');

describe('crypto.util (AES-256-GCM)', () => {
  it('round-trips a secret', () => {
    const packed = encryptSecret('super-secret-r2-key', KEY_A);
    expect(packed.startsWith('gcm1.')).toBe(true);
    expect(packed).not.toContain('super-secret-r2-key'); // ciphertext, not plaintext
    expect(decryptSecret(packed, KEY_A)).toBe('super-secret-r2-key');
  });

  it('produces a different ciphertext each time (random IV)', () => {
    expect(encryptSecret('x', KEY_A)).not.toBe(encryptSecret('x', KEY_A));
  });

  it('fails to decrypt with the wrong key', () => {
    const packed = encryptSecret('secret', KEY_A);
    expect(() => decryptSecret(packed, KEY_B)).toThrow();
  });

  it('detects tampering (auth tag mismatch)', () => {
    const packed = encryptSecret('secret', KEY_A);
    const parts = packed.split('.');
    const ct = Buffer.from(parts[3], 'base64');
    ct[0] = ct[0] ^ 0xff; // flip a byte of the ciphertext
    parts[3] = ct.toString('base64');
    expect(() => decryptSecret(parts.join('.'), KEY_A)).toThrow();
  });

  it('rejects malformed ciphertext', () => {
    expect(() => decryptSecret('not-a-valid-blob', KEY_A)).toThrow('Malformed');
  });

  it('loadKey rejects a missing key', () => {
    expect(() => loadKey('')).toThrow(EncryptionKeyError);
  });

  it('loadKey rejects a too-short / non-hex key', () => {
    expect(() => loadKey('abc')).toThrow(EncryptionKeyError);
    expect(() => loadKey('z'.repeat(64))).toThrow(EncryptionKeyError);
  });

  it('loadKey accepts a valid 64-hex key', () => {
    expect(loadKey('ab'.repeat(32))).toHaveLength(32);
  });
});
