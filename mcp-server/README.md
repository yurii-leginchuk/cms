# poirier-cms MCP server

A standalone [Model Context Protocol](https://modelcontextprotocol.io) server that lets
Claude Code drive the Poirier CMS **Meta**, **Schema (JSON-LD)** and **ALT-text** modules
end-to-end.

It is a **thin stdio client over the CMS REST API** (via `axios`) — it does **not** import
NestJS code or touch the database. It runs on the host and reaches the Dockerized CMS through
the published port (`http://localhost:3000`, global prefix `/api`).

- Transport: **stdio** (Claude Code launches the process).
- SDK: [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) `1.29.0` + `zod` `^3.25`.
- Server name advertised to clients: **`poirier-cms`**.

---

## Configuration (env)

| Var | Default | Purpose |
|-----|---------|---------|
| `CMS_BASE_URL` | `http://localhost:3000` | CMS origin **without** the `/api` prefix. |
| `CMS_API_KEY` | _(unset)_ | Optional. When set, sent as both `Authorization: Bearer <key>` and `X-API-Key: <key>` (forward-compat with auth landing on another branch). |
| `CMS_DEFAULT_SITE_ID` | _(unset)_ | Optional default `siteId` used when a tool omits it. |

---

## Build & run

```bash
cd mcp-server
npm install
npm run build        # tsc → dist/
npm start            # runs dist/index.js over stdio
```

Other scripts: `npm run typecheck` (tsc --noEmit), `npm run smoke` (integration smoke test —
requires the CMS running at `CMS_BASE_URL`).

---

## Register with Claude Code

Already merged into the repo-root `.mcp.json` (alongside `shadcn` / `playwright`):

```json
{
  "mcpServers": {
    "poirier-cms": {
      "type": "stdio",
      "command": "node",
      "args": ["mcp-server/dist/index.js"],
      "env": { "CMS_BASE_URL": "http://localhost:3000" }
    }
  }
}
```

Build first (`npm run build`) so `dist/index.js` exists. To set a default site, add
`"CMS_DEFAULT_SITE_ID": "<uuid>"` to the `env` block.

Alternatively, via the CLI:

```bash
claude mcp add poirier-cms -- node /absolute/path/to/mcp-server/dist/index.js
# add env: --env CMS_BASE_URL=http://localhost:3000 --env CMS_DEFAULT_SITE_ID=<uuid>
```

---

## Human approval gate (IMPORTANT)

**MCP changes never take effect or publish on their own.** Every editing tool stages a
**PENDING proposal** (`POST /api/sites/:siteId/changes`) that a human must review and accept in
the CMS Overview. **Accept = applies the change to the module AND publishes it to WordPress;
Reject = discards.** The MCP server has **no publishing tools** — they were removed. Humans
editing directly in the CMS are unaffected (their edits are not gated).

## Tool catalog (23 tools)

Legend: **[read]** read-only · **[propose]** stages a PENDING proposal for human approval ·
**[suggest]** returns an AI suggestion (no publish) · **[$]** consumes AI tokens · **[media]**
adds a WordPress media asset (not a page change).

### Discovery & shared
| Tool | Purpose |
|------|---------|
| `list_sites` | **[read]** List all CMS sites (id, name, url, pagesCount). |
| `list_pages` | **[read]** List a site's pages with a one-line meta summary. Search + paginate. |
| `get_page` | **[read]** Full meta/SEO state of one page (by `pageId` or `pageUrl`). |
| `upload_image` | **[media]** Upload a local image file to WordPress media → `{id,url}` (use as OG image). |

### Meta
| Tool | Purpose |
|------|---------|
| `meta_update` | **[propose]** Propose changing any subset of meta fields (title/description/indexDirective/nofollow/canonical/OG…). |
| `meta_generate_ai` | **[suggest][$]** Suggest a meta title + description (no persist). |
| `meta_history` | **[read]** Meta change history for a page. |

### Schema (JSON-LD)
| Tool | Purpose |
|------|---------|
| `schema_list` | **[read]** List managed schemas for a page (ids for update/delete). |
| `schema_get_detected` | **[read]** Last persisted detection result (no re-run). |
| `schema_detect` | **[read]** Re-detect + validate from stored HTML (CMS-side, no publish). |
| `schema_reparse` | **[read]** Re-fetch the live page and re-detect (CMS-side, no publish). |
| `schema_validate` | **[read]** Validate a JSON-LD object/array (no site/page needed). |
| `schema_add` | **[propose]** Propose adding a managed schema. |
| `schema_update` | **[propose]** Propose editing a managed schema by id. |
| `schema_delete` | **[propose]** Propose removing a managed schema by id. |
| `schema_analyze_ai` | **[suggest][$]** Grounded AI schema suggestions/fixes/drift flags (no persist). |
| `schema_qc` | **[read]** Reconcile managed ↔ plugin ↔ live-rendered. |
| `schema_coverage` | **[read]** Site-wide structured-data coverage. |

### ALT text
| Tool | Purpose |
|------|---------|
| `alt_list` | **[read]** Paginated image library + alt + review status (`missingOnly`). |
| `alt_coverage` | **[read]** Honest alt coverage stats. |
| `alt_reconcile` | **[read]** Re-derive the library from scraped pages (CMS-side, no publish). |
| `alt_generate` | **[suggest][$]** Grounded AI alt suggestion for one image (held as non-published `ai_suggested`; apply via `alt_set`). |
| `alt_set` | **[propose]** Propose setting an image's alt text. |

### Removed tools (MCP must never publish or bypass the gate)
`meta_apply`, `schema_apply`, `schema_apply_all`, `alt_apply`, `alt_apply_all`,
`alt_autopilot` (all published to WordPress) and `alt_generate_missing`, `alt_approve`,
`alt_revert` (bulk AI persist / direct draft-state mutation outside the queue).

### The propose → human-accept model

Editing tools call `POST /changes` to stage a PENDING proposal carrying the change `payload`, a
`before` snapshot, and a human-readable `summary`. Nothing is applied or published until a
human accepts it in the CMS (accept reuses the CMS's own services to apply + publish; reject
discards). `upload_image` is the one non-proposal write — it adds a media asset, not a page
change — and is documented as such.

---

## Design notes

- **Page resolution:** page-scoped tools accept `pageId` **or** `pageUrl`; a URL is resolved to a
  pageId against the site's page list (exact match preferred; ambiguity is reported).
- **siteId fallback:** omit `siteId` to use `CMS_DEFAULT_SITE_ID`.
- **Response envelope:** the CMS wraps every response in `{ data: … }` (the pages list is
  therefore double-nested); the client unwraps it transparently.
- **Output shaping:** every tool returns a concise text summary **and** `structuredContent`.
  Heavy fields (`rawHtml`, page content) are stripped; long strings/arrays truncated; large
  payloads aggregated to types/validity/ids.
- **Errors:** backend error messages (`{ statusCode, message }`) surface as `isError` tool
  results rather than throwing.
- **stdio safety:** all logging goes to **stderr** (stdout is the JSON-RPC channel).

---

## Smoke test

`src/smoke.ts` connects an in-process MCP `Client` to the server over an in-memory linked
transport and exercises the gated flow against a running CMS: it asserts the publish tools are
gone, that `meta_update` + `schema_add` stage PENDING proposals (and the page draft is NOT
mutated), then plays the human via the REST approval endpoints — **accept** the meta proposal
(verifying it applies + publishes) and **reject** the schema proposal (verifying it never
reaches the managed set) — and confirms the direct in-CMS human edit path still works. Bounded
and self-cleaning; it does **not** run mass AI generation.

```bash
npm run build
CMS_BASE_URL=http://localhost:3000 npm run smoke
```
