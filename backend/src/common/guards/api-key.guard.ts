import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { timingSafeEqual } from 'node:crypto';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Shared-secret guard for the machine-to-machine boundary between the MCP
 * server (Claude Code) and this backend.
 *
 * OPT-IN BY DESIGN: when `MCP_API_KEY` is empty/unset the guard is a no-op, so
 * local development keeps working with no auth (today's behaviour). Once the key
 * is configured, EVERY route requires it — supplied as either
 * `Authorization: Bearer <key>` or `X-API-Key: <key>` — except routes marked
 * `@Public()` (e.g. the health check). The MCP client already sends both
 * headers when `CMS_API_KEY` is set; the CMS frontend sends `X-API-Key` from
 * `VITE_CMS_API_KEY`.
 *
 * Note: this is a single shared secret for trusted clients, not per-user auth
 * (that is the separate Phase-0 work). CORS preflight (OPTIONS) is handled by
 * the cors middleware before guards run, so it is unaffected.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const expected = (this.config.get<string>('MCP_API_KEY') || '').trim();
    // No key configured → gate disabled (local-dev default).
    if (!expected) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const provided = extractKey(context.switchToHttp().getRequest());
    if (!provided || !safeEqual(provided, expected)) {
      throw new UnauthorizedException('Invalid or missing API key.');
    }
    return true;
  }
}

/** Pull the key from `X-API-Key` or a `Bearer` Authorization header. */
function extractKey(req: {
  headers?: Record<string, string | string[] | undefined>;
}): string | null {
  const xApiKey = req.headers?.['x-api-key'];
  if (typeof xApiKey === 'string' && xApiKey) return xApiKey.trim();

  const auth = req.headers?.authorization;
  if (typeof auth === 'string' && auth.startsWith('Bearer ')) {
    const token = auth.slice('Bearer '.length).trim();
    if (token) return token;
  }
  return null;
}

/** Constant-time comparison to avoid leaking the key via timing. */
function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}
