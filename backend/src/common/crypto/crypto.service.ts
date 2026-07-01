import { Injectable } from '@nestjs/common';
import { encryptSecret, decryptSecret, loadKey } from './crypto.util';

/**
 * Thin injectable wrapper over the AES-256-GCM helpers so services can encrypt
 * on write and decrypt only server-side (when calling R2/Cloudflare). The plain
 * secret never leaves the server and is never logged.
 */
@Injectable()
export class CryptoService {
  encrypt(plain: string): string {
    return encryptSecret(plain);
  }

  decrypt(packed: string): string {
    return decryptSecret(packed);
  }

  /** True when ENCRYPTION_KEY is present and valid (for a config health hint). */
  isConfigured(): boolean {
    try {
      loadKey();
      return true;
    } catch {
      return false;
    }
  }
}
