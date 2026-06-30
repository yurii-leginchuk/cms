/**
 * Runtime configuration, sourced from environment variables.
 *
 * The MCP server runs on the HOST and reaches the Dockerized CMS through its
 * published port (default http://localhost:3000). The CMS exposes everything
 * under the global `/api` prefix and currently has NO auth on the main branch;
 * CMS_API_KEY is wired through for forward-compat with the auth landing on
 * another branch.
 */
export interface Config {
  /** CMS origin WITHOUT the /api prefix, e.g. http://localhost:3000. */
  baseUrl: string;
  /** Optional API key; when set it is sent as a bearer + X-API-Key header. */
  apiKey?: string;
  /** Optional default siteId used when a tool call omits siteId. */
  defaultSiteId?: string;
}

export function loadConfig(): Config {
  const baseUrl = (process.env.CMS_BASE_URL || 'http://localhost:3000').replace(
    /\/+$/,
    '',
  );
  return {
    baseUrl,
    apiKey: process.env.CMS_API_KEY || undefined,
    defaultSiteId: process.env.CMS_DEFAULT_SITE_ID || undefined,
  };
}
