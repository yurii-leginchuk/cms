/**
 * Integration smoke test for the HUMAN-APPROVAL-GATE contract.
 *
 * Connects an in-process MCP Client to the real server and exercises the live
 * CMS flow, then plays the "human" via the REST approval endpoints:
 *   - confirms the publish tools are GONE and edit tools now PROPOSE.
 *   - meta_update + schema_add stage PENDING proposals (NOT applied/published).
 *   - GET /changes shows them pending; get_page proves the draft is untouched.
 *   - Accept the meta proposal  → applies + publishes (get_page reflects it).
 *   - Reject the schema proposal → discarded (never reaches managed/WP).
 *   - Restores the page via the DIRECT human path (proves it's still ungated).
 *
 * BOUNDED + SELF-CLEANING. Run:  CMS_BASE_URL=http://localhost:3000 node dist/smoke.js
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

const BASE = (process.env.CMS_BASE_URL || 'http://localhost:3000').replace(/\/+$/, '');
const TEST_SITE = process.env.CMS_DEFAULT_SITE_ID || 'bbd7da26-2e16-4480-8dde-a2cd713ed084';
process.env.CMS_DEFAULT_SITE_ID = TEST_SITE;

const { createServer } = await import('./index.js');

let passed = 0;
let failed = 0;
function check(name: string, condition: boolean, detail = '') {
  if (condition) {
    passed++;
    console.log(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failed++;
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

// Minimal REST helper that unwraps the { data } envelope (the human side).
// Sends the API key (when set) so the test's human-side calls pass the
// backend's API-key gate, mirroring what the MCP client does.
const API_KEY = process.env.CMS_API_KEY;
async function api(method: string, path: string, body?: unknown): Promise<any> {
  const headers: Record<string, string> = {};
  if (body) headers['Content-Type'] = 'application/json';
  if (API_KEY) {
    headers.Authorization = `Bearer ${API_KEY}`;
    headers['X-API-Key'] = API_KEY;
  }
  const res = await fetch(`${BASE}/api${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${JSON.stringify(json.message ?? json)}`);
  return json.data ?? json;
}

async function main() {
  const server = createServer();
  const client = new Client({ name: 'smoke-client', version: '0.1.0' });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);

  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res: any = await client.callTool({ name, arguments: args });
    const text = (res.content || []).filter((c: any) => c.type === 'text').map((c: any) => c.text).join('\n');
    return { text, structured: res.structuredContent, isError: !!res.isError };
  };

  console.log('\n=== tools/list (gated contract) ===');
  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name);
  console.log(`  ${names.length} tools: ${names.join(', ')}`);
  const expected = [
    'list_sites', 'list_pages', 'get_page', 'upload_image',
    'meta_update', 'meta_generate_ai', 'meta_history',
    'schema_list', 'schema_get_detected', 'schema_detect', 'schema_reparse',
    'schema_validate', 'schema_add', 'schema_update', 'schema_delete',
    'schema_analyze_ai', 'schema_qc', 'schema_coverage',
    'alt_list', 'alt_coverage', 'alt_reconcile', 'alt_generate', 'alt_set',
  ];
  const mustBeGone = [
    'meta_apply', 'schema_apply', 'schema_apply_all',
    'alt_apply', 'alt_apply_all', 'alt_autopilot',
    'alt_generate_missing', 'alt_approve', 'alt_revert',
  ];
  check('all expected tools present', expected.every((e) => names.includes(e)),
    `missing: ${expected.filter((e) => !names.includes(e)).join(', ') || 'none'}`);
  check('all publish/ungated tools REMOVED', mustBeGone.every((g) => !names.includes(g)),
    `still present: ${mustBeGone.filter((g) => names.includes(g)).join(', ') || 'none'}`);

  console.log('\n=== discover target page ===');
  const pages = await call('list_pages', { siteId: TEST_SITE, limit: 10 });
  const pageRows: any[] = pages.structured?.pages || [];
  const target = pageRows.find((p) => /\/services\//.test(p.url)) || pageRows[0];
  check('found a target page', !!target, target?.url);

  const before = await call('get_page', { siteId: TEST_SITE, pageId: target.id });
  const origOgTitle = before.structured?.page?.ogTitle ?? null;
  const origIndex = before.structured?.page?.indexDirective ?? 'default';
  console.log(`  original ogTitle=${JSON.stringify(origOgTitle)} indexDirective=${origIndex}`);

  console.log('\n=== MCP edit tools now PROPOSE (no direct effect) ===');
  const marker = `MCP-GATE ${Date.now()}`;
  const metaProp = await call('meta_update', {
    siteId: TEST_SITE, pageId: target.id, ogTitle: marker, indexDirective: 'noindex',
  });
  console.log(`  meta_update → ${metaProp.text}`);
  check('meta_update returns "awaiting approval"', /awaiting human approval/i.test(metaProp.text));
  const metaId = metaProp.structured?.proposal?.id;
  check('meta proposal has an id', !!metaId, metaId);

  const goodLd = { '@context': 'https://schema.org', '@type': 'Organization', name: 'Gate Test', url: 'https://example.com' };
  const schemaProp = await call('schema_add', {
    siteId: TEST_SITE, pageId: target.id, type: 'Organization', jsonld: goodLd,
  });
  console.log(`  schema_add → ${schemaProp.text}`);
  check('schema_add returns "awaiting approval"', /awaiting human approval/i.test(schemaProp.text));
  const schemaId = schemaProp.structured?.proposal?.id;

  console.log('\n=== proposals are PENDING in the CMS, NOT yet applied ===');
  const counts = await api('GET', `/sites/${TEST_SITE}/changes/counts`);
  console.log(`  counts: ${JSON.stringify(counts)}`);
  check('counts show pending meta + schema', counts.meta >= 1 && counts.schema >= 1);

  const afterPropose = await call('get_page', { siteId: TEST_SITE, pageId: target.id });
  check('page draft UNCHANGED by proposal (not applied)',
    (afterPropose.structured?.page?.ogTitle ?? null) === origOgTitle &&
    (afterPropose.structured?.page?.indexDirective ?? 'default') === origIndex,
    `ogTitle=${JSON.stringify(afterPropose.structured?.page?.ogTitle)}`);

  const managedBefore = await call('schema_list', { siteId: TEST_SITE, pageId: target.id });
  const managedCountBefore = (managedBefore.structured?.schemas || []).length;

  console.log('\n=== ACCEPT the meta proposal → applies + publishes ===');
  const accepted = await api('POST', `/sites/${TEST_SITE}/changes/${metaId}/accept`);
  console.log(`  accept → status=${accepted.status} decidedAt=${accepted.decidedAt}`);
  check('meta proposal accepted', accepted.status === 'accepted');
  const afterAccept = await call('get_page', { siteId: TEST_SITE, pageId: target.id });
  check('accepted meta APPLIED to page', afterAccept.structured?.page?.ogTitle === marker,
    `ogTitle=${JSON.stringify(afterAccept.structured?.page?.ogTitle)}`);
  check('accepted meta published (syncStatus pending/synced)',
    ['pending', 'synced', 'syncing'].includes(String(afterAccept.structured?.page?.syncStatus)),
    `syncStatus=${afterAccept.structured?.page?.syncStatus}`);

  console.log('\n=== REJECT the schema proposal → discarded, never applied ===');
  const rejected = await api('POST', `/sites/${TEST_SITE}/changes/${schemaId}/reject`);
  check('schema proposal rejected', rejected.status === 'rejected');
  const managedAfter = await call('schema_list', { siteId: TEST_SITE, pageId: target.id });
  const managedCountAfter = (managedAfter.structured?.schemas || []).length;
  check('rejected schema NOT added to managed set', managedCountAfter === managedCountBefore,
    `before=${managedCountBefore} after=${managedCountAfter}`);

  console.log('\n=== direct human edit path still works (ungated) → restore page ===');
  await api('PATCH', `/sites/${TEST_SITE}/pages/${target.id}`, {
    ogTitle: origOgTitle, indexDirective: origIndex,
  });
  await api('POST', `/sites/${TEST_SITE}/sync/page/${target.id}`);
  const restored = await call('get_page', { siteId: TEST_SITE, pageId: target.id });
  check('direct human PATCH restored original meta',
    (restored.structured?.page?.ogTitle ?? null) === origOgTitle);

  console.log('\n=== final pending counts ===');
  const finalCounts = await api('GET', `/sites/${TEST_SITE}/changes/counts`);
  console.log(`  counts: ${JSON.stringify(finalCounts)}`);

  await client.close();
  await server.close();
  console.log(`\n=== RESULT: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('Smoke test crashed:', e);
  process.exit(1);
});
