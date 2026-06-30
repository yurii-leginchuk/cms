/**
 * poirier-cms MCP server — a thin stdio client over the CMS REST API that lets
 * Claude Code drive the Meta, Schema (JSON-LD) and ALT-text modules end-to-end.
 *
 * IMPORTANT: stdio transport uses stdout for the JSON-RPC wire. NEVER write to
 * stdout — all logging goes to stderr.
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { loadConfig } from './config.js';
import { CmsClient } from './cms-client.js';
import { registerDiscoveryTools } from './tools/discovery.js';
import { registerMetaTools } from './tools/meta.js';
import { registerSchemaTools } from './tools/schema.js';
import { registerAltTools } from './tools/alt.js';

/** Build a fully-wired server (importable for the in-memory smoke test). */
export function createServer(): McpServer {
  const config = loadConfig();
  const client = new CmsClient(config);

  const server = new McpServer({ name: 'poirier-cms', version: '0.1.0' });

  registerDiscoveryTools(server, client);
  registerMetaTools(server, client);
  registerSchemaTools(server, client);
  registerAltTools(server, client);

  return server;
}

async function main() {
  const server = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Connected. Logging to stderr only (stdout is the protocol channel).
  console.error('[poirier-cms] MCP server connected over stdio.');
}

main().catch((err) => {
  console.error('[poirier-cms] Fatal:', err);
  process.exit(1);
});
