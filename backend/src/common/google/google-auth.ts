import { UnauthorizedException } from '@nestjs/common';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as crypto from 'crypto';
import axios, { AxiosError } from 'axios';

/**
 * Reusable Google service-account auth (same JSON key as GSC — one service
 * account, multiple scopes). Hand-rolls the JWT → access-token exchange and
 * caches per scope, mirroring GscService.getToken so GA4 (and any future Google
 * API) can authenticate without duplicating the flow or refactoring GSC.
 *
 * The SAME service account must be granted access to each API's resource: added
 * as a user in Search Console for GSC, and as a Viewer in GA4 Property Access.
 */
export interface ServiceAccountCreds {
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** Credentials file path — shared with GSC (GSC_CREDENTIALS_PATH or cwd). */
export const GOOGLE_CREDS_PATH =
  process.env.GSC_CREDENTIALS_PATH || path.join(process.cwd(), 'gsc-credentials.json');

function b64url(input: string): string {
  return Buffer.from(input).toString('base64url');
}

export async function loadGoogleCreds(): Promise<ServiceAccountCreds> {
  let raw: string;
  try {
    raw = await fs.readFile(GOOGLE_CREDS_PATH, 'utf8');
  } catch {
    throw new UnauthorizedException(`Google credentials file not found at: ${GOOGLE_CREDS_PATH}`);
  }
  let creds: ServiceAccountCreds;
  try {
    creds = JSON.parse(raw) as ServiceAccountCreds;
  } catch {
    throw new UnauthorizedException('Google credentials file is not valid JSON');
  }
  if (!creds.client_email || !creds.private_key) {
    throw new UnauthorizedException(
      'Google credentials file is missing client_email or private_key — place a valid service account JSON key.',
    );
  }
  return creds;
}

const tokenCache = new Map<string, { token: string; expiresAt: number }>();

/** Acquire (and cache) a service-account access token for a scope. */
export async function getGoogleAccessToken(scope: string): Promise<string> {
  const cached = tokenCache.get(scope);
  if (cached && cached.expiresAt - Date.now() > 60_000) return cached.token;

  const creds = await loadGoogleCreds();
  const now = Math.floor(Date.now() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = b64url(
    JSON.stringify({
      iss: creds.client_email,
      scope,
      aud: creds.token_uri ?? 'https://oauth2.googleapis.com/token',
      exp: now + 3600,
      iat: now,
    }),
  );
  const sign = crypto.createSign('RSA-SHA256');
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(creds.private_key, 'base64url');
  const jwt = `${header}.${payload}.${signature}`;

  try {
    const res = await axios.post(
      creds.token_uri ?? 'https://oauth2.googleapis.com/token',
      new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } },
    );
    const token: string = res.data.access_token;
    tokenCache.set(scope, { token, expiresAt: Date.now() + 3_500_000 });
    return token;
  } catch (err) {
    const msg = err instanceof AxiosError ? JSON.stringify(err.response?.data) : (err as Error).message;
    throw new UnauthorizedException(`Google token exchange failed: ${msg}`);
  }
}
