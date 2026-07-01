import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * AES-256-GCM secret encryption for at-rest credential storage.
 *
 * Key: 32 bytes, provided as 64 hex chars in env `ENCRYPTION_KEY`
 *   generate with:  openssl rand -hex 32
 *
 * Packed ciphertext format (all base64):  `gcm1.<iv>.<authTag>.<ciphertext>`
 * GCM's auth tag gives tamper detection — decrypt throws on any modification or
 * a wrong key, so we never silently return corrupted plaintext.
 *
 * FAIL-SAFE: a missing / malformed key throws EncryptionKeyError, so a
 * misconfigured server refuses to store secrets rather than writing plaintext.
 */

const ALGO = 'aes-256-gcm';
const PREFIX = 'gcm1';

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionKeyError';
  }
}

/** Load & validate the 32-byte key. `raw` overrides env (used by tests). */
export function loadKey(raw?: string | null): Buffer {
  const val = (raw ?? process.env.ENCRYPTION_KEY ?? '').trim();
  if (!val) {
    throw new EncryptionKeyError(
      'ENCRYPTION_KEY is not set. Generate one with `openssl rand -hex 32`.',
    );
  }
  if (!/^[0-9a-fA-F]{64}$/.test(val)) {
    throw new EncryptionKeyError(
      'ENCRYPTION_KEY must be 64 hex chars (32 bytes). Generate with `openssl rand -hex 32`.',
    );
  }
  return Buffer.from(val, 'hex');
}

export function encryptSecret(plain: string, key?: Buffer): string {
  const k = key ?? loadKey();
  const iv = randomBytes(12); // 96-bit nonce, GCM standard
  const cipher = createCipheriv(ALGO, k, iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [
    PREFIX,
    iv.toString('base64'),
    tag.toString('base64'),
    ct.toString('base64'),
  ].join('.');
}

export function decryptSecret(packed: string, key?: Buffer): string {
  const k = key ?? loadKey();
  const parts = (packed ?? '').split('.');
  if (parts.length !== 4 || parts[0] !== PREFIX) {
    throw new Error('Malformed ciphertext.');
  }
  const iv = Buffer.from(parts[1], 'base64');
  const tag = Buffer.from(parts[2], 'base64');
  const ct = Buffer.from(parts[3], 'base64');
  const decipher = createDecipheriv(ALGO, k, iv);
  decipher.setAuthTag(tag);
  // .final() throws if the auth tag doesn't match (tamper / wrong key).
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
