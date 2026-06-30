import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiKeyGuard } from './api-key.guard';

/** Build an ExecutionContext whose request carries the given headers. */
function ctx(headers: Record<string, string>): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    getHandler: () => undefined,
    getClass: () => undefined,
  } as unknown as ExecutionContext;
}

function makeGuard(key: string | undefined, isPublic = false) {
  const config = { get: () => key } as unknown as ConfigService;
  const reflector = {
    getAllAndOverride: () => isPublic,
  } as unknown as Reflector;
  return new ApiKeyGuard(reflector, config);
}

const KEY = 's3cret-key';

describe('ApiKeyGuard', () => {
  it('is a no-op when no key is configured (gate disabled)', () => {
    const guard = makeGuard(undefined);
    expect(guard.canActivate(ctx({}))).toBe(true);
  });

  it('treats a blank/whitespace key as disabled', () => {
    const guard = makeGuard('   ');
    expect(guard.canActivate(ctx({}))).toBe(true);
  });

  it('allows a matching X-API-Key', () => {
    const guard = makeGuard(KEY);
    expect(guard.canActivate(ctx({ 'x-api-key': KEY }))).toBe(true);
  });

  it('allows a matching Bearer token', () => {
    const guard = makeGuard(KEY);
    expect(guard.canActivate(ctx({ authorization: `Bearer ${KEY}` }))).toBe(true);
  });

  it('rejects a request with no key when the gate is on', () => {
    const guard = makeGuard(KEY);
    expect(() => guard.canActivate(ctx({}))).toThrow(UnauthorizedException);
  });

  it('rejects a wrong key', () => {
    const guard = makeGuard(KEY);
    expect(() => guard.canActivate(ctx({ 'x-api-key': 'nope' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('rejects a wrong-length key (constant-time compare guard)', () => {
    const guard = makeGuard(KEY);
    expect(() => guard.canActivate(ctx({ 'x-api-key': 'short' }))).toThrow(
      UnauthorizedException,
    );
  });

  it('lets @Public() routes through even with the gate on', () => {
    const guard = makeGuard(KEY, true);
    expect(guard.canActivate(ctx({}))).toBe(true);
  });
});
