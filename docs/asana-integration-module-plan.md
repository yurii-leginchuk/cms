# Asana Integration Module — Implementation Plan

Status: PLAN ONLY (no code written). Branch: `main`. Date: 2026-07-01.

This module adds Asana task-management to poirier-cms: a **Task Monitoring** page,
an **Asana Settings** page, full task create/manage capability, and an **MCP**
surface so Claude Code can drive Asana through the CMS. It is designed to slot
into the larger **claude-seo × CMS × Asana** loop (CMS = data + source-of-truth +
review gate; Asana = the task-tracking layer of the SEO optimization loop).

It mirrors the conventions of the existing **Image Optimization** module
(`backend/src/optimization/`) — per-site config, encrypted credentials, a
`@Public()` HMAC-verified webhook receiver — and the **MCP approval-gate** module
(`backend/src/mcp-changes/`, `mcp-server/`).

---

## 1. Goal & Scope

> **SCOPE DECISION (2026-07-01, user):** The CMS tracks **only the tasks it
> created** (origin `cms`/`mcp`) — NOT the whole Asana project. There is no bulk
> import/monitor of a project's existing tasks. The local mirror holds only
> CMS-owned tasks; "Sync now" re-hydrates those rows (per-task), and the
> monitoring page shows only them. Consequently the monitoring view is empty
> until the CMS starts creating tasks (Phase 2). The site→project mapping still
> matters: it's the project the CMS creates its tasks **into**.
>
> **Escape hatch (built):** a task created OUTSIDE the CMS can be adopted for
> tracking by **pasting its Asana URL** (or GID) — `POST …/tasks/track`. It must
> belong to the mapped project; it lands with origin `tracked` and is refreshed
> by "Sync now" like any tracked task. This is the ONLY way an external task
> enters the mirror — still explicit, still not a bulk project import.

### Goal
Let the team create and manage Asana tasks from inside the CMS (and from Claude
Code via MCP), and monitor the status of **the tasks the CMS created** — with each
Asana **project mapped to a CMS site** and tasks optionally **linked to a CMS entity**
(a page, a meta change, or a schema change) so an SEO fix becomes a tracked task.

### In scope
- Connect an Asana account (Personal Access Token), pick a workspace.
- Map each CMS **site → one Asana project** (locked program decision).
- Read/monitor a site's tasks (name, assignee, status/section, due date, completed,
  subtasks, last-synced freshness).
- Create tasks, update tasks (name/notes/due/completed), change **status**
  (board section), change **assignee**, create **subtasks**.
- Link a task to a CMS entity (page / meta change / schema change).
- Expose all of the above via MCP tools (thin client over new CMS REST endpoints).
- **Webhook-driven** status sync (locked program decision — not polling), with an
  on-demand "Sync now" reconcile as a fallback.

### Out of scope (initial)
- Multi-workspace / multi-account support (single workspace in Phase 1).
- OAuth2 login flow (PAT only — see §2).
- Portfolios, goals, teams, tags, attachments, comments/stories authoring
  (comments/stories may be a later read-only add).
- Custom-field authoring UI (status via **sections** first; enum-custom-field as a
  later option — see §2).
- Hard-deleting Asana tasks from the CMS (complete/soft only initially — see §9).

### How it fits the site-per-project SEO loop
claude-seo produces optimization recommendations; the CMS is where a human reviews
and gates changes to live WordPress. Asana is the **work-tracking** layer: a
recommendation ("add FAQ schema to /pricing") becomes an Asana task in the site's
project, linked to the CMS schema/meta entity it concerns. Status flows back into
the CMS via webhooks so the monitoring view reflects reality. This module is built
**self-contained** (the `docs/claude-seo-*.md` program docs live on an unpushed
branch and are NOT on `main`), but its data model deliberately supports that loop
via the `linkedEntity*` columns and the site→project mapping.

---

## 2. Asana API Research Findings (cited)

**Base URL / version:** `https://app.asana.com/api/1.0` (API "v1"). Requests use
`Authorization: Bearer <token>`. Responses wrap payloads in `{ "data": ... }`.
([Quick start](https://developers.asana.com/docs/quick-start))

### 2.1 Authentication — PAT vs OAuth2 → **recommend PAT**
- A **Personal Access Token (PAT)** carries a user's credentials and is the fast
  path for "a script or simple app that doesn't need to support multiple users
  logging in." OAuth is for apps where many end-users each sign in.
  ([PAT](https://developers.asana.com/docs/personal-access-token),
  [OAuth](https://developers.asana.com/docs/oauth))
- This is a **single-team internal tool** with one shared service identity, so a
  PAT is sufficient and far simpler. Trade-offs: a PAT is tied to the person who
  minted it (tasks are created "as" that user; if they leave/revoke it, the
  integration breaks) and it is a long-lived secret → **must be encrypted at rest**
  (we already have that pattern). OAuth would add per-user attribution + refresh
  but needs a redirect flow, client registration, and token refresh plumbing —
  disproportionate here. **Recommendation: PAT now; leave an OAuth seam for later.**
- Scope: a token operates within the **workspaces** the minting user belongs to;
  we pin one workspace GID in config.

### 2.2 Core objects & endpoints
- **Tasks**: `POST /tasks` (create — body `data` with `name`, `notes`, `workspace`
  or `projects`, `assignee`, `due_on`, `completed`, `parent` for subtasks);
  `PUT /tasks/{gid}` (update — only provided fields change);
  `GET /tasks/{gid}`; `DELETE /tasks/{gid}`; requires `tasks:write` scope.
  ([Create](https://developers.asana.com/reference/createtask),
  [Update](https://developers.asana.com/reference/updatetask),
  [Tasks](https://developers.asana.com/reference/tasks))
- **Subtasks**: a subtask is just a task with a `parent`. Create via
  `POST /tasks/{parent_gid}/subtasks` (or `POST /tasks` with `parent`). List via
  `GET /tasks/{parent_gid}/subtasks`.
- **Assignee**: set `assignee` (a user GID) on create/update. User pickers come
  from the workspace users list.
- **Users**: `GET /workspaces/{gid}/users` (or `GET /users?workspace=`) for the
  assignee picker; `GET /users/me` to validate the token + discover workspaces.
- **Projects / Workspaces**: `GET /workspaces`, `GET /projects?workspace={gid}`.
  One project ↔ one CMS site (locked decision).
- **Sections**: `GET /projects/{gid}/sections`, `POST /sections/{gid}/addTask`
  (moves a task into a section — "removes the task from other sections of the
  project" and inserts at top unless `insert_before/after`).
  ([Add task to section](https://developers.asana.com/reference/addtaskforsection))
- **Custom fields**: enum custom fields store a **GID of the chosen `enum_option`**,
  not the text; you must first `GET /projects/{gid}/custom_field_settings` to learn
  the field + option GIDs. ([Custom fields](https://developers.asana.com/docs/custom-fields-guide))
- **Stories/comments**: available (`GET/POST /tasks/{gid}/stories`) — deferred.

### 2.3 **How "status" is actually modeled** (the key question) → **use SECTIONS**
Asana has **no single "status" field**. Workflow status is expressed three ways:
1. **Sections** (board columns like *To Do / In Progress / Review / Done*) — the
   task belongs to one section per project; moving it = `POST /sections/{gid}/addTask`.
2. **`completed`** boolean (done / not done) — orthogonal to section.
3. An **enum custom field** (e.g. a "Status" dropdown) — value is an `enum_option`
   GID; requires reading `custom_field_settings` first.

**Recommendation for the CMS model:** treat **project sections as the canonical
"status" column** (this is how a board's workflow reads to a human, and it's the
one every project has), and mirror the **`completed`** boolean as a separate "Done"
signal. Store `sectionGid` + `sectionName` per task; "set status" = move to a
section. Support **enum-custom-field status as an optional later mode** (behind the
same "set status" API) for teams that model status as a dropdown — but do **not**
build it in Phase 1/2. This keeps the mental model honest (we show what Asana
actually stores) and avoids guessing.

### 2.4 Webhooks
- Establish with `POST /webhooks` `{ resource: <projectGid>, target: <public URL>,
  filters: [...] }`. Asana immediately POSTs the target with an **`X-Hook-Secret`**
  header; you **echo that header back** with `200/204` to complete the handshake,
  and **store the secret**. Only then does the create call return `201`.
  ([Webhooks guide](https://developers.asana.com/docs/webhooks-guide))
- Every subsequent event POST carries **`X-Hook-Signature`** — a **SHA256 HMAC of
  the full raw request body** keyed by the stored `X-Hook-Secret`. Verify with a
  constant-time compare (identical shape to our existing `webhook-auth.ts`, just
  HMAC instead of plain-secret equality).
- **Watchable resource**: we watch the **project** (`resource_type: task`,
  actions `added/changed/removed/deleted`). Higher-level (workspace) webhooks
  require filters; project-level is the right grain here.
- **Events are thin** — the payload's `events[]` contain only GIDs + change kind,
  **not** the full resource. Each event → a follow-up `GET /tasks/{gid}` to hydrate
  the mirror.
- **Reachability**: the target **must be publicly reachable**. Asana retries failed
  deliveries with backoff for ~24h, then **deletes the webhook**. Respond `410` to
  decline events. → **Local-dev implication in §5.**

### 2.5 Rate limits & pagination
- **150 req/min** (Free) / **1,500 req/min** (Starter+); **Search = 60 req/min**.
  Plus a cost-based limit for expensive traversals. `429` responses carry
  **`Retry-After`** → exponential backoff.
  ([Rate limits](https://developers.asana.com/docs/rate-limits))
- **Pagination** is opaque-offset: pass `limit` and follow `next_page.offset` until
  `next_page` is null (NOT page numbers).

---

## 3. Data Model

### Decision: mirror-vs-live → **hybrid (webhook-driven local mirror + read-through reconcile)**

| Option | Pros | Cons |
|---|---|---|
| **Live read-through only** | Always fresh; no schema | Can't store CMS-entity links; every list view hits Asana (rate limits, latency); no offline/honest-freshness; hard to filter/sort densely |
| **Local mirror only (poll)** | Fast, linkable, filterable | Polling was explicitly rejected by the program; staleness risk |
| **Hybrid (recommended)** | Fast dense list from mirror; **webhooks keep it fresh** (locked decision); can store `linkedEntity*`; "Sync now" reconcile heals missed events; honest `lastSyncedAt` | One mirror table to keep in sync; must be honest about staleness |

**Recommendation: hybrid.** The mirror is the CMS's own row per Asana task (fast,
filterable, and — crucially — the only place we can attach a CMS-entity link).
Webhooks push changes in; writes update the mirror **optimistically** then reconcile
on the echoed webhook; a manual **"Sync now"** does a full read-through to heal any
missed events. The UI always shows `lastSyncedAt` and a stale/"webhook down" badge
(dual-timestamp honesty, matching the crawl/index module).

### New TypeORM entities (`backend/src/asana/`)

**`asana_connection`** — single global row (the account/workspace connection; the
PAT is workspace-scoped, not per-site, so it lives once, like `settings`):
- `id uuid`, `patEnc text` (AES-256-GCM, **never returned**), `workspaceGid varchar`,
  `workspaceName varchar`, `userGid`/`userName` (of `GET /users/me`),
  `status enum(untested|verified|failed)`, `verifiedAt timestamptz`,
  `lastError varchar(255)` (scrubbed), `createdAt`, `updatedAt`.
- Public view exposes only `patSet: boolean` + workspace + status (mirrors
  `OptimizationConfigPublic` redaction and `settings.service` `SECRET_KEYS`).

**`asana_project_map`** — per-site mapping + webhook state (unique `siteId`):
- `id uuid`, `siteId uuid` **unique**, `projectGid varchar`, `projectName varchar`,
  `webhookGid varchar null`, `webhookSecretEnc text null` (encrypted),
  `webhookStatus enum(none|pending|active|error)`, `webhookLastReceivedAt timestamptz`,
  `lastFullSyncAt timestamptz`, `syncError varchar(255) null`,
  `createdAt`, `updatedAt`, `ManyToOne Site onDelete CASCADE`.

**`asana_task`** — the mirror (one row per Asana task we track):
- `id uuid`, `siteId uuid` (indexed), `projectGid varchar`, `taskGid varchar` **unique**,
  `name text`, `notes text null`, `assigneeGid varchar null`, `assigneeName varchar null`,
  `sectionGid varchar null`, `sectionName varchar null`, `completed boolean`,
  `dueOn date null`, `permalinkUrl varchar null`, `parentTaskGid varchar null`
  (set ⇒ this row is a subtask), `numSubtasks int default 0`,
  `raw jsonb` (last hydrated Asana payload — audit/debug),
  `linkedEntityType varchar null` (`page|meta|schema`), `linkedEntityId varchar null`,
  `origin varchar(16) default 'asana'` (`asana|cms|mcp` — for "created by AI" surfacing),
  `lastEventAt timestamptz null`, `lastSyncedAt timestamptz`, `createdAt`, `updatedAt`.
- Indexes: `(siteId, completed)`, `(siteId, sectionGid)`, `(taskGid)` unique,
  `(linkedEntityType, linkedEntityId)`.

*(Assignee/user list and project section list are read **live** and lightly cached
in-memory per request — no dedicated tables needed initially.)*

### Migration
`backend/src/migrations/1785000000000-AddAsanaIntegration.ts` — creates the three
tables (raw SQL, `CREATE TABLE IF NOT EXISTS`, reversible `down()` drops all three),
following `1784000000000-AddCrawlIndexInspection.ts` exactly. Dev uses
`synchronize:true` (auto-creates from entities); prod runs the migration.

---

## 4. Backend Design (`backend/src/asana/`)

Module layout mirrors `optimization.module.ts` / `schema.module.ts`.

**Services**
- **`AsanaApiClient`** — thin wrapper over `https://app.asana.com/api/1.0` (axios).
  Bearer auth from the decrypted PAT (injected per call, never stored in the client).
  Responsibilities: unwrap `{data}`, **opaque-offset pagination** (follow
  `next_page.offset`), **429/`Retry-After` exponential backoff** with a max-retry
  cap, cost-limit awareness, and error scrubbing (never log the token/body). Pure
  helpers (`shouldRetry`, `nextBackoffMs`, `collectPaginated`) are unit-tested like
  `r2-helpers.spec.ts`.
- **`AsanaConnectionService`** — encrypted-PAT storage (encrypt on write via
  `CryptoService`, decrypt only server-side), `verify()` (`GET /users/me` +
  `GET /workspaces`), workspace selection, redacted public view.
- **`AsanaProjectService`** — list workspace projects, set the per-site
  `projectGid`, list a project's **sections** (status options) and **users**
  (assignee picker), establish/delete the webhook.
- **`AsanaTaskService`** — read from the **mirror** (filter/sort/paginate);
  write ops go **live to Asana then upsert the mirror** (optimistic) — create,
  update, `setStatus` (section move via `POST /sections/{gid}/addTask` + optional
  `completed`), `setAssignee`, `createSubtask`, `linkEntity` (CMS-only column write,
  no Asana call).
- **`AsanaSyncService`** — full read-through reconcile for a site (heals missed
  webhooks; sets `lastFullSyncAt`) and single-task hydrate (`GET /tasks/{gid}` →
  upsert) used by the webhook handler.
- **`AsanaWebhookService`** — handshake (echo `X-Hook-Secret`, store encrypted),
  **HMAC verify** (`X-Hook-Signature`), map thin events → `hydrateTask()`,
  stamp `webhookLastReceivedAt`.

**Controllers / REST endpoints** (consumed by BOTH the frontend and MCP — listed
explicitly since that's the contract):

*Connection / settings (global):*
- `GET  /asana/connection` — redacted status (`patSet`, workspace, status, verifiedAt).
- `PUT  /asana/connection` — set/replace PAT (encrypt; reset status to untested).
- `POST /asana/connection/verify` — validate token, return workspaces.
- `GET  /asana/workspaces` — list workspaces for the token.
- `PUT  /asana/connection/workspace` — pin the workspace GID.
- `GET  /asana/projects` — list projects in the pinned workspace (for mapping).
- `GET  /asana/users` — workspace users (assignee picker).

*Per-site:*
- `GET    /sites/:siteId/asana/mapping` — project map + webhook health + freshness.
- `PUT    /sites/:siteId/asana/mapping` — set `projectGid`.
- `GET    /sites/:siteId/asana/sections` — project sections (status options).
- `POST   /sites/:siteId/asana/webhook` — establish webhook (Phase 3).
- `DELETE /sites/:siteId/asana/webhook` — remove webhook.
- `POST   /sites/:siteId/asana/sync` — full reconcile ("Sync now").
- `GET    /sites/:siteId/asana/tasks` — list mirror (query: `section`, `assignee`,
  `completed`, `search`, `page`, `limit`).
- `GET    /sites/:siteId/asana/tasks/:taskGid` — detail (+ subtasks).
- `POST   /sites/:siteId/asana/tasks` — create task.
- `PATCH  /sites/:siteId/asana/tasks/:taskGid` — update name/notes/due/completed.
- `POST   /sites/:siteId/asana/tasks/:taskGid/status` — move to section (+completed).
- `POST   /sites/:siteId/asana/tasks/:taskGid/assignee` — set assignee.
- `POST   /sites/:siteId/asana/tasks/:taskGid/subtasks` — create subtask.
- `POST   /sites/:siteId/asana/tasks/:taskGid/link` — link to CMS entity
  (`{ entityType, entityId }`), unlink with nulls.

*Webhook (public):*
- `POST /webhooks/asana/:siteId` — handshake + event delivery (see §5).

All non-webhook endpoints sit behind the global `ApiKeyGuard` (`AUTH_ENFORCE`);
the webhook controller is `@Public()` and signature-verified. DTOs live in
`asana/dto/` with `class-validator` (matching `optimization/dto/`).

**Module wiring:** register `AsanaModule` in `app.module.ts`;
`TypeOrmModule.forFeature([AsanaConnection, AsanaProjectMap, AsanaTask, Site])`;
import `CryptoModule`. Export `AsanaTaskService` + `AsanaProjectService` so the
MCP-facing controllers (and any future agent tools) can reuse them.

---

## 5. Webhook Design

Directly parallels `optimization/webhook.controller.ts` + `webhook.service.ts` +
`webhook-auth.ts`, upgraded from plain-secret to HMAC.

1. **Establish** (`POST /sites/:siteId/asana/webhook`): backend calls
   `POST /webhooks` with `resource = projectGid`, `target =
   <CMS_PUBLIC_URL>/api/webhooks/asana/:siteId`, filters
   `[{resource_type:'task', action:'added|changed|removed|deleted'}]`.
2. **Handshake**: Asana POSTs the target with `X-Hook-Secret`. The controller
   detects the secret header, **stores it encrypted** on `asana_project_map`
   (`webhookSecretEnc`), and **echoes `X-Hook-Secret` back** with `200`. Set
   `webhookStatus=pending`; the `POST /webhooks` response returns the `webhookGid`
   (store it) → set `active`.
3. **Event delivery**: each subsequent POST carries `X-Hook-Signature`. Verify =
   `HMAC-SHA256(rawBody, decrypt(webhookSecretEnc))` constant-time-compared to the
   header. A new `verifyHookSignature()` pure helper lives beside a
   `asana-webhook-auth.spec.ts` (same shape/tests as `webhook-auth.spec.ts`).
   **Requires the raw body** — register a raw-body capture for this route (Nest
   `rawBody`/verify hook) since HMAC is over the exact bytes.
4. **Hydrate**: for each thin event, `AsanaSyncService.hydrateTask(gid)` upserts the
   mirror; stamp `webhookLastReceivedAt`. `removed/deleted` → mark the mirror row
   completed/absent (soft).
5. **Decline/cleanup**: unknown/mismatched site → `410` (Asana stops sending).

**Reachability / local-dev implication (call-out):** webhooks need a **publicly
reachable HTTPS URL**. In production `CMS_PUBLIC_URL` is public. **Locally, Asana
cannot reach `localhost`** — Phase 3 requires a tunnel (`cloudflared`/`ngrok`) with
`CMS_PUBLIC_URL` pointed at it, OR you simply skip webhook establishment in dev and
rely on the manual **"Sync now"** reconcile (Phases 1–2 work fully without
webhooks). This is why webhooks are Phase 3, not Phase 1.

---

## 6. Frontend Design

Conventions and specific reuse targets are taken from the **UX advisory** (folded
in below). Two surfaces: **global Settings** (account + workspace + all mappings) and
a **per-site Task Monitoring** page. The advisory's central warning: *the feature's
credibility rests on honest sync-trust signalling* — a mirror that looks live but
isn't destroys trust and users revert to Asana's own UI. So sync-trust is a P0, not
a polish item.

**Navigation:** add one per-site **"Tasks"** `SidebarIcon` in `RootLayout.tsx` (after
"Index Status"; `ListTodo`/`CheckSquare` from lucide, icon-only like the rest).
Routes in `App.tsx`:
- `sites/:id/tasks` → `SiteTasksPage` (Task Monitoring)
- `sites/:id/tasks/:taskGid` → `TaskDetailPage` (list→detail nav like
  `IndexStatusDetailPage`, NOT a giant modal — task detail is too rich for a dialog)
- `settings/asana` → `AsanaSettingsPage` (global connection + workspace + all
  site→project mappings), reachable from `SettingsPage.tsx`.

**API client + hooks:** `frontend/src/api/asana.ts` + `frontend/src/hooks/useAsana.ts`
(React Query, matching `useOptimization.ts`/`useCrawl.ts`).

### Asana Settings page (`AsanaSettingsPage.tsx`)
Reuse the `SiteOptimizationPage.tsx` card-stack + credential grammar wholesale.
- **Connection card**: PAT via the existing `SecretInput` (write-only, shown only as
  `isSet`/`verified`, "•••• set — leave blank to keep"), a **"Test connection"**
  button (mirrors R2's), and a **linear health checklist of chips** —
  *Token valid → Workspace selected → Webhook established → Receiving events* — each
  with its own status chip in the `R2StatusChip`/`DnsStatusChip` visual grammar.
- **Workspace select** (populated after verify).
- **Site→Project mapping table**: each site, its mapped project (searchable select
  from `/asana/projects`), per-row webhook health + retry (surface a failed webhook
  create on the row, never silently), and `lastFullSyncAt`.
- States: not-connected (empty), verifying (loading), invalid/revoked-token (error
  banner "reconnect"), connected-no-workspace, connected.

### Task Monitoring page (`SiteTasksPage.tsx`)
- **Sync-trust strip (P0, the spine)** — modeled on `index-status/FreshnessQuotaStrip`
  + `RelativeClock`. Three **never-merged** honest signals plus an escape hatch:
  (1) **Last synced** (`RelativeClock` w/ `staleDays` → amber when old = mirror
  freshness); (2) **Webhook health** chip — `receiving` (green) / `idle` (neutral =
  connected but quiet ≠ down) / `stale — not receiving` (amber) / `down` (red);
  (3) **[Refresh]** = force read-through "Sync now" so a missed webhook is never a
  dead end. Keep the CMS clock and Asana's "last modified" clock **separate** (same
  dual-timestamp honesty as the crawl module).
- **Header actions**: **[+ New task]** (primary, top-right) and "Open in Asana"
  deep-links per row ("the mirror is for monitoring; Asana remains the system for
  deep work — don't reimplement Asana").
- **Dense table** (grouped by **section/status**; optional board toggle P2) —
  columns: name (truncate + `title`), assignee (avatar/initials, explicit
  "Unassigned"), status chip (section name in **Asana's own terms**, colored via a
  `statusMeta`-style map), due date (overdue amber/red via `staleDays` threshold),
  completed, subtask count (collapsed w/ badge, expand on demand), and a **`Sparkles`
  "AI" marker on `origin='mcp'` rows** (P0 — never blur human vs agent authorship on
  a shared board). Filters: section, assignee, completed, search, **"linked to CMS"**,
  **"AI-created"**. `Skeleton` rows for loading (never a bare spinner);
  `Pagination` + server filters for large projects.
- **Three distinct empty states (P0 — do not collapse):** (1) *not connected* (amber
  `gscOffline`-style banner → link to Settings); (2) *connected but site not mapped*
  (→ "Map a project"); (3) *mapped, zero tasks* (teaching empty + `+ New task`).
- **Optimistic writes with visible rollback (P0):** status/assignee changes update the
  row immediately with a subtle "saving…", and **on Asana failure roll the row back +
  toast the scrubbed error** (safe only because we can revert to the last mirrored
  value). A write awaiting its confirming webhook shows "pending sync", not "settled".
- **Create/edit:** lightweight **[+ New task] popover** (name, assignee, due, section)
  for the 80% case (no page bounce); rich work (description, subtasks, linking) on the
  **detail page**. `ConfirmDialog` only for the irreversible — **delete** and
  **unlink** — never for create/status-change.
- **Bulk actions (P1):** reuse the `SiteIndexStatusPage` checkbox column + floating
  selection bar → bulk-complete / bulk-assign / bulk-move-section.

### Task detail (`TaskDetailPage.tsx`)
List→detail like `IndexStatusDetailPage`: notes, subtasks, status(section)/assignee/
due/completed controls, an activity timeline (`HistoryRow` pattern), and the
**CMS-entity link (P0, bidirectional):** a chip "Linked: Schema — LocalBusiness" /
"Linked: Meta — /pricing" that **navigates to that entity** (like the detail page's
"Edit Meta" cross-link), and reciprocally a "Tracked by Asana task ▸" affordance on
the schema/meta side. If an AI task also opened a pending MCP change, reflect its
proposal state (proposed/approved/applied) reusing `SchemaProposalCard` states
(pending decision #10).

**Reuse map:** `SecretInput`/`ConfirmDialog`/`StatCard` + R2 health-banner from
`SiteOptimizationPage`; `FreshnessQuotaStrip`/`RelativeClock`/selection-bar/`Table`/
`Skeleton`/`Pagination`/`gscOffline` from `SiteIndexStatusPage` + `index-status/`;
`statusMeta.ts`/`IndexStatusChip` for the status chip map; `SchemaProposalCard`
(`Sparkles`) for AI marking; `IndexStatusDetailPage` for list→detail + `HistoryRow`;
one `SidebarIcon` in `RootLayout.tsx`.

---

## 7. MCP Tools

**Thin-client rule (enforced):** MCP tools call **new CMS REST endpoints** only;
**all Asana API calls happen in the backend.** New file
`mcp-server/src/tools/asana.ts` registered in `mcp-server/src/index.ts` via
`registerAsanaTools(server, client)`; client verbs already exist on `CmsClient`.

| MCP tool | Backend endpoint | Notes |
|---|---|---|
| `asana_list_projects` | `GET /asana/projects` | discovery |
| `asana_list_users` | `GET /asana/users` | assignee picker |
| `asana_list_sections` | `GET /sites/:id/asana/sections` | status options |
| `asana_list_tasks` | `GET /sites/:id/asana/tasks` | from mirror; filters |
| `asana_get_task` | `GET /sites/:id/asana/tasks/:gid` | + subtasks |
| `asana_create_task` | `POST /sites/:id/asana/tasks` | write |
| `asana_update_task` | `PATCH /sites/:id/asana/tasks/:gid` | name/notes/due/completed |
| `asana_set_status` | `POST /sites/:id/asana/tasks/:gid/status` | section move |
| `asana_set_assignee` | `POST /sites/:id/asana/tasks/:gid/assignee` | |
| `asana_create_subtask` | `POST /sites/:id/asana/tasks/:gid/subtasks` | |
| `asana_link_task` | `POST /sites/:id/asana/tasks/:gid/link` | link to CMS entity |

Read tools set `readOnlyHint: true`; write tools `readOnlyHint: false`,
`openWorldHint: false`.

**Approval gate — DECIDED (§9.5): MCP writes are GATED via `mcp-changes`.**
The user chose the pending-approval queue: **MCP-origin write operations do NOT hit
Asana directly.** Instead each write (`asana_create_task`, `asana_update_task`,
`asana_set_status`, `asana_set_assignee`, `asana_create_subtask`, `asana_link_task`)
is recorded as a **pending change** in the existing `mcp-changes` module. Claude Code
gets back a pending-change id + human-readable diff (e.g. *"Create task 'Fix /pricing
meta' in project → In Progress, assignee Alice"*); the operator approves it in the CMS
(reusing the existing pending-changes UI/flow), and only **on approval** does the
backend call the Asana API and upsert the mirror. Rejection discards it. Read tools
(`asana_list_*`, `asana_get_task`) stay **direct** (no gate).

Rule: **origin=`mcp` writes → gated; direct UI writes (the operator acting in the CMS)
→ immediate** — the operator is already the approver there. All applied writes are
audited (`origin`, actor) and carry the ✨ "AI" marker on `origin='mcp'` rows. This
extends the existing gate's meaning consistently: anything an agent initiates waits
for a human, whether it publishes to WordPress or writes to Asana.

---

## 8. Phased Rollout & Test Strategy

Repo uses **Jest** backend specs (`*.spec.ts`) — see existing `webhook-auth.spec.ts`,
`r2-helpers.spec.ts`, `optimization-config` usage. Each phase ships green tests +
both builds.

### Phase 1 — Connect + Read/Monitor (no writes, no webhooks) — ✅ BUILT (2026-07-01, branch `main`)
Delivered: `backend/src/asana/` (3 entities, `AsanaApiClient` + pure helpers,
connection/project/sync/task services, global + per-site controllers, DTOs),
migration `1785000000000-AddAsanaIntegration.ts`, module wired into `app.module.ts`;
frontend `api/asana.ts` + `hooks/useAsana.ts` + `AsanaSettingsPage` (connection +
workspace + per-site project mapping), `SiteTasksPage` (read-only monitor: sync-trust
strip, filters, 3 empty states, AI marker), `TaskDetailPage` (read-only: notes +
subtasks + dual-clock), sidebar "Tasks" icon + `settings/asana` link. **372 backend
tests green (19 new in `asana-helpers.spec.ts`), backend + frontend builds green,
frontend typecheck clean.** Live run pending a real Asana PAT.

- Entities + migration; `AsanaApiClient` (pagination + 429 backoff);
  `AsanaConnectionService` (encrypt PAT, verify, workspace); `AsanaProjectService`
  (list projects/sections/users, set mapping); `AsanaSyncService.fullSync`
  (read-through populate mirror); connection + per-site read endpoints;
  **Settings page** + **Task Monitoring page (read-only)** + "Sync now".
- Tests: pagination-collect + backoff pure helpers; PAT encrypt + **redaction**
  (never leaks token); sync upsert/idempotency; section→status mapping.

### Phase 2 — Create / Update / Subtasks / Link — ✅ BUILT (2026-07-01, branch `feat/asana-integration`)
Delivered: write ops in `AsanaTaskService` (create → origin `cms`; update
name/notes/due/completed; set status = section move + optional completed; set
assignee; create subtask; link/unlink CMS entity) writing live to Asana then
upserting the mirror; **untrack** (`DELETE …/tasks/:gid` — removes the mirror row,
does NOT touch Asana). REST: `POST tasks`, `PATCH tasks/:gid`, `DELETE tasks/:gid`,
`POST tasks/:gid/{status,assignee,subtasks,link}`. Pure `buildTaskData` (only-provided
fields → Asana names, null passes through) unit-tested. Frontend: "+ New task" create
form + row "stop tracking" on `SiteTasksPage`; fully **editable `TaskDetailPage`**
(inline name, completed toggle, status/assignee selects, due date, notes save,
add-subtask, link/unlink, stop tracking). **381 backend tests green; both builds +
FE typecheck clean; verified live** on the "PA CMS Test" project (create→assign→
section→update→subtask→link→complete→untrack all confirmed, UI screenshot verified).
NOTE: writes here are the DIRECT UI path; MCP writes stay GATED (Phase 3). Optimistic
mirror + rollback was deferred (writes re-fetch via React Query invalidation instead).

### Phase 3 — Webhooks + MCP — ✅ BUILT (2026-07-01, branch `feat/asana-integration`)
**3a Webhooks** (commit f6efcac): `@Public()` raw-body controller
`/webhooks/asana/:siteId`; X-Hook-Secret handshake (stored encrypted, echoed);
HMAC-SHA256 `verifyHookSignature` + `extractTaskEvents` (pure, unit-tested);
events reconcile ONLY tracked tasks (hydrate/prune); establish/remove endpoints +
`createWebhook`/`deleteWebhook`; establish refuses a non-public `CMS_PUBLIC_URL`.
FE: per-site live-sync chip + Enable/Disable in settings; monitor sync-trust chip
reflects real webhook health. Full delivery needs a public URL (can't live-test on
localhost). **3b Gated MCP** (commit f6c1915): `mcp-changes` extended with module
`asana` + actions (create/update/status/assignee/subtask/link) + `targetType 'task'`;
`accept()` dispatches to `AsanaTaskService` (write goes live to Asana on approval).
MCP tools (`mcp-server/src/tools/asana.ts`): reads + `asana_track` direct; all
Asana-mutating tools stage a PENDING proposal. FE approval queue renders Asana
proposals (tab + AsanaDiff). **Verified live: propose→pending(counts asana:1)→
accept→task created in Asana; reject never creates.** 389 backend tests green;
MCP + both builds green.

<!-- original Phase 3 plan retained below -->
- Webhook controller (`@Public()`, raw-body), handshake echo, **HMAC verify**
  (`verifyHookSignature` + spec), event → hydrate, freshness stamps; establish/delete
  endpoints + Settings webhook health UI; **MCP tools** (`asana.ts`) + smoke;
  action audit (`origin`); local-dev tunnel note.
- **MCP write gating (decided §5/§7):** MCP write tools record a **pending change** in
  `mcp-changes` (with a human-readable diff) instead of calling Asana; the existing
  pending-changes approval flow applies the write + upserts the mirror on approve, and
  discards on reject. Read tools stay direct. Reuse the existing `mcp-changes` entity/
  UI; add an Asana change-type + applier.
- Tests: `asana-webhook-auth.spec.ts` (HMAC verify, constant-time, length-mismatch,
  missing-secret — mirrors `webhook-auth.spec.ts`); handshake echo; event-hydrate
  upsert; **pending-change create→approve→apply (calls Asana once) / reject→no-op**;
  MCP in-memory smoke (like `mcp-server/src/smoke.ts`).

---

## 9. Open Decisions for the User

**Resolved with the user (2026-07-01):** #1 PAT (rotatable), #3 sections + `completed`,
#4 hybrid mirror, #5 **GATED via `mcp-changes`**. Remaining items keep their
recommended defaults unless the user says otherwise.

1. **Auth method** — ✅ **DECIDED: PAT.** Single-team internal tool; encrypted at rest.
   **Must be rotatable/replaceable** from the Settings page: masked `SecretInput`,
   "Update token" (re-encrypt overwrite), "Test connection" (`GET /users/me` → shows
   account + ✅/❌), "Disconnect" (clear token). OAuth seam left for later.
2. **Workspace scope** — single pinned workspace vs multi-workspace.
   **Recommend: single workspace in Phase 1** (matches "one team"); multi later.
3. **How "status" is modeled** — ✅ **DECIDED: sections (board columns) as the status
   column + mirror `completed`.** Enum-custom-field status remains an optional later mode.
4. **Mirror vs live** — ✅ **DECIDED: hybrid webhook-mirror + "Sync now"** (fast,
   filterable, stores CMS-entity links, honest freshness; webhooks keep it fresh).
5. **MCP task writes: gated or direct?** — ✅ **DECIDED: GATED.** MCP-origin writes go
   through the `mcp-changes` pending-approval queue; the operator approves before the
   backend calls Asana (see §7). Direct UI writes stay immediate. This moves the MCP
   tools from Phase 3 into the same phase as the gate wiring (see updated §8).
6. **Where the PAT lives** — dedicated `asana_connection` entity vs the global
   `settings` table (`SECRET_KEYS`). **Recommend: dedicated entity** (carries
   workspace + verify status cleanly), reusing the same redaction discipline.
7. **Local-dev webhooks** — require a tunnel (`cloudflared`/`ngrok`) vs skip webhooks
   in dev and rely on "Sync now". **Recommend: skip in dev (manual sync works);
   tunnel only when testing Phase 3**; production uses `CMS_PUBLIC_URL`.
8. **Task deletion** — allow hard-delete from CMS/MCP vs complete/soft-only.
   **Recommend: complete/soft-only initially;** hard delete (if added) is gated.
9. **CMS-entity link scope** — which entities a task may link to in Phase 2
   (page / meta change / schema change). **Recommend: page + meta + schema**, via the
   generic `linkedEntityType/linkedEntityId` columns.
10. **Webhook liveness signal** (UX advisory) — Asana webhooks have **no heartbeat**,
    so "connected but quiet" is indistinguishable from "silently dropped" without a
    probe. **Recommend: a lightweight periodic liveness check** (a cheap
    `GET /webhooks/{gid}` or a small reconcile on a timer) purely to drive the
    honest `receiving/idle/stale/down` chip — this does NOT violate the
    "no-polling-for-status" decision (status still arrives by webhook; the poll only
    checks the pipe). Accept "idle vs down" ambiguity for Phase 3 if you prefer to
    defer.
11. **AI task ↔ pending-change coupling** (UX advisory) — when `claude-seo` creates a
    task linked to a CMS change, should the task also open a **pending MCP change** in
    the existing approval gate, and should the link chip show proposal state
    (proposed/approved/applied)? **Recommend: keep them independent in Phase 2/3**
    (task = tracking; the CMS change follows the existing gate separately), and only
    surface combined state if the program explicitly needs it.
12. **Link cardinality** (UX advisory) — one task ↔ one entity, or many-to-many?
    **Recommend: one task links to at most one CMS entity** (single
    `linkedEntityType/linkedEntityId` pair) for Phase 2; a join table only if
    many-to-many proves necessary.
13. **Token identity** (UX advisory) — is the PAT **one shared team/service token**
    or **per-user**? This affects task authorship attribution and Settings placement.
    **Recommend: one shared service token** (minted by a service/owner account),
    consistent with the single-global-connection model in §3.

---

## Appendix — Sources
- Quick start / base URL: https://developers.asana.com/docs/quick-start
- Create task: https://developers.asana.com/reference/createtask
- Update task: https://developers.asana.com/reference/updatetask
- Tasks reference: https://developers.asana.com/reference/tasks
- Add task to section: https://developers.asana.com/reference/addtaskforsection
- Custom fields guide: https://developers.asana.com/docs/custom-fields-guide
- Webhooks guide: https://developers.asana.com/docs/webhooks-guide
- Personal access token: https://developers.asana.com/docs/personal-access-token
- OAuth: https://developers.asana.com/docs/oauth
- Rate limits: https://developers.asana.com/docs/rate-limits
