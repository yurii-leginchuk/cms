import { SetMetadata } from '@nestjs/common';

/** Metadata key used by ApiKeyGuard to skip the API-key check on a route. */
export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Mark a route (or controller) as public so the global ApiKeyGuard lets it
 * through even when MCP_API_KEY is configured. Use sparingly — only for
 * unauthenticated endpoints such as health checks.
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
