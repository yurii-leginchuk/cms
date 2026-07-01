/**
 * Asana task-tracking tools.
 *
 * HUMAN APPROVAL GATE: every tool that writes to Asana (create / update /
 * set_status / set_assignee / create_subtask / link) stages a PENDING proposal
 * a human must accept in the CMS (accept = applies the write live to Asana).
 * Read tools and asana_track (adopt an existing task into CMS tracking — a
 * reversible, CMS-local action that does NOT mutate Asana) run directly.
 *
 * The CMS tracks ONLY tasks it created or was told to track — not the whole
 * Asana project.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { CmsClient } from '../cms-client.js';
import { guard, ok, truncate } from '../util.js';
import { siteIdField } from './shared.js';

const taskGidField = z.string().describe('Asana task gid (from asana_list_tasks / asana_get_task).');
const dueOnField = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'dueOn must be YYYY-MM-DD')
  .optional()
  .describe('Due date, YYYY-MM-DD.');

function taskLine(t: any): string {
  const status = t.completed ? 'done' : t.sectionName || 'no section';
  const who = t.assigneeName || 'Unassigned';
  return `- [${t.taskGid}] ${truncate(t.name, 70)} — ${status} · ${who}${t.dueOn ? ` · due ${t.dueOn}` : ''}${t.origin === 'mcp' ? ' · AI' : ''}`;
}

const proposed = (change: { id: string; summary: string }) =>
  ok(
    `Proposed change #${change.id} — "${change.summary}" — awaiting human approval in the CMS.`,
    { proposal: change },
  );

export function registerAsanaTools(server: McpServer, client: CmsClient) {
  const site = (id?: string) => client.resolveSiteId(id);

  // ── Reads (direct) ──────────────────────────────────────────────────────────

  server.registerTool(
    'asana_status',
    {
      title: 'Asana connection + mapping status',
      description:
        'Read-only: is Asana connected, which workspace, and which project this site maps to (+ webhook/sync health).',
      inputSchema: { siteId: siteIdField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const conn = (await client.get('/asana/connection')) as any;
        const mapping = (await client.get(`/sites/${site(args.siteId)}/asana/mapping`)) as any;
        return ok(
          `Asana: ${conn.status}${conn.workspaceName ? ` (${conn.workspaceName})` : ''}. ` +
            `Project: ${mapping.projectName ?? '(not mapped)'}. Webhook: ${mapping.webhookStatus}.`,
          { connection: conn, mapping },
        );
      }),
  );

  server.registerTool(
    'asana_list_tasks',
    {
      title: 'List tracked Asana tasks',
      description:
        'Read-only: list the tasks the CMS tracks for a site (not the whole project). Filter by section, assignee, completed, search, or AI-created.',
      inputSchema: {
        siteId: siteIdField,
        search: z.string().optional(),
        section: z.string().optional().describe('Section gid (from asana_list_sections).'),
        assignee: z.string().optional().describe('Assignee gid (from asana_list_users).'),
        completed: z.boolean().optional(),
        aiOnly: z.boolean().optional().describe('Only tasks created via MCP/AI.'),
        limit: z.number().int().min(1).max(200).optional(),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const res = (await client.get(`/sites/${site(args.siteId)}/asana/tasks`, {
          search: args.search,
          section: args.section,
          assignee: args.assignee,
          completed: args.completed === undefined ? undefined : String(args.completed),
          aiOnly: args.aiOnly ? 'true' : undefined,
          limit: args.limit ?? 50,
        })) as any;
        const rows = res.data ?? [];
        return ok(
          `${res.meta?.total ?? rows.length} tracked task(s):\n${rows.map(taskLine).join('\n') || '(none)'}`,
          { tasks: rows, meta: res.meta },
        );
      }),
  );

  server.registerTool(
    'asana_get_task',
    {
      title: 'Get a tracked task (+ subtasks)',
      description: 'Read-only: fetch one tracked task with its live subtasks.',
      inputSchema: { siteId: siteIdField, taskGid: taskGidField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const res = (await client.get(
          `/sites/${site(args.siteId)}/asana/tasks/${args.taskGid}`,
        )) as any;
        const t = res.task;
        return ok(
          `${t.name}\n${t.completed ? 'done' : t.sectionName || 'no section'} · ${t.assigneeName || 'Unassigned'}${t.dueOn ? ` · due ${t.dueOn}` : ''}\n` +
            `${res.subtasks?.length ?? 0} subtask(s):\n${(res.subtasks ?? []).map(taskLine).join('\n')}`,
          { task: t, subtasks: res.subtasks },
        );
      }),
  );

  server.registerTool(
    'asana_list_sections',
    {
      title: 'List Asana sections (status columns)',
      description: 'Read-only: the mapped project\'s sections — the available "status" values.',
      inputSchema: { siteId: siteIdField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const rows = (await client.get(`/sites/${site(args.siteId)}/asana/sections`)) as any[];
        return ok(
          `${rows.length} section(s):\n${rows.map((s) => `- [${s.gid}] ${s.name}`).join('\n')}`,
          { sections: rows },
        );
      }),
  );

  server.registerTool(
    'asana_list_users',
    {
      title: 'List Asana workspace users',
      description: 'Read-only: workspace users (assignee gids) for set_assignee / create.',
      inputSchema: { siteId: siteIdField },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () =>
      guard(async () => {
        const rows = (await client.get('/asana/users')) as any[];
        return ok(
          `${rows.length} user(s):\n${rows.map((u) => `- [${u.gid}] ${u.name}`).join('\n')}`,
          { users: rows },
        );
      }),
  );

  // ── Adopt an existing task (direct — reversible, CMS-local, no Asana write) ──

  server.registerTool(
    'asana_track',
    {
      title: 'Track an existing Asana task by URL',
      description:
        'Start tracking an existing Asana task (created outside the CMS) by its URL or gid. The task must belong to the site\'s mapped project. Reversible and CMS-local (does not modify Asana), so it runs directly — no approval needed.',
      inputSchema: {
        siteId: siteIdField,
        url: z.string().describe('Asana task URL or gid.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const t = (await client.post(`/sites/${site(args.siteId)}/asana/tasks/track`, {
          url: args.url,
        })) as any;
        return ok(`Now tracking "${t.name}" [${t.taskGid}].`, { task: t });
      }),
  );

  // ── Writes (GATED — stage a proposal) ───────────────────────────────────────

  server.registerTool(
    'asana_create_task',
    {
      title: 'Propose creating an Asana task (needs approval)',
      description:
        'Propose creating a task in the site\'s mapped Asana project. Stages a PENDING proposal a human accepts in the CMS (accept = creates it in Asana).',
      inputSchema: {
        siteId: siteIdField,
        name: z.string().describe('Task name.'),
        notes: z.string().optional().describe('Description.'),
        assigneeGid: z.string().optional(),
        sectionGid: z.string().optional().describe('Starting section (status).'),
        dueOn: dueOnField,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const change = await client.createChange(site(args.siteId), {
          module: 'asana',
          action: 'asana.create',
          targetType: 'task',
          targetId: '-',
          targetLabel: args.name,
          payload: {
            name: args.name,
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
            ...(args.assigneeGid ? { assigneeGid: args.assigneeGid } : {}),
            ...(args.sectionGid ? { sectionGid: args.sectionGid } : {}),
            ...(args.dueOn ? { dueOn: args.dueOn } : {}),
          },
        });
        return proposed(change);
      }),
  );

  server.registerTool(
    'asana_update_task',
    {
      title: 'Propose updating a task (needs approval)',
      description:
        'Propose editing a tracked task (name / notes / due / completed). Stages a PENDING proposal a human accepts (accept = applies it in Asana).',
      inputSchema: {
        siteId: siteIdField,
        taskGid: taskGidField,
        name: z.string().optional(),
        notes: z.string().optional(),
        dueOn: z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.null()]).optional().describe('YYYY-MM-DD, or null to clear.'),
        completed: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const payload: Record<string, unknown> = {};
        if (args.name !== undefined) payload.name = args.name;
        if (args.notes !== undefined) payload.notes = args.notes;
        if (args.dueOn !== undefined) payload.dueOn = args.dueOn;
        if (args.completed !== undefined) payload.completed = args.completed;
        const change = await client.createChange(site(args.siteId), {
          module: 'asana',
          action: 'asana.update',
          targetType: 'task',
          targetId: args.taskGid,
          payload,
        });
        return proposed(change);
      }),
  );

  server.registerTool(
    'asana_set_status',
    {
      title: 'Propose moving a task to a section (needs approval)',
      description:
        'Propose moving a tracked task to a section (its "status"), optionally marking it completed. Stages a PENDING proposal.',
      inputSchema: {
        siteId: siteIdField,
        taskGid: taskGidField,
        sectionGid: z.string().describe('Target section gid (from asana_list_sections).'),
        completed: z.boolean().optional(),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const change = await client.createChange(site(args.siteId), {
          module: 'asana',
          action: 'asana.status',
          targetType: 'task',
          targetId: args.taskGid,
          payload: {
            sectionGid: args.sectionGid,
            ...(args.completed !== undefined ? { completed: args.completed } : {}),
          },
        });
        return proposed(change);
      }),
  );

  server.registerTool(
    'asana_set_assignee',
    {
      title: 'Propose (re)assigning a task (needs approval)',
      description: 'Propose setting or clearing a tracked task\'s assignee. Stages a PENDING proposal.',
      inputSchema: {
        siteId: siteIdField,
        taskGid: taskGidField,
        assigneeGid: z.union([z.string(), z.null()]).describe('User gid, or null to unassign.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const change = await client.createChange(site(args.siteId), {
          module: 'asana',
          action: 'asana.assignee',
          targetType: 'task',
          targetId: args.taskGid,
          payload: { assigneeGid: args.assigneeGid ?? null },
        });
        return proposed(change);
      }),
  );

  server.registerTool(
    'asana_create_subtask',
    {
      title: 'Propose adding a subtask (needs approval)',
      description: 'Propose creating a subtask under a tracked task. Stages a PENDING proposal.',
      inputSchema: {
        siteId: siteIdField,
        taskGid: taskGidField.describe('Parent task gid.'),
        name: z.string(),
        notes: z.string().optional(),
        assigneeGid: z.string().optional(),
        dueOn: dueOnField,
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const change = await client.createChange(site(args.siteId), {
          module: 'asana',
          action: 'asana.subtask',
          targetType: 'task',
          targetId: args.taskGid,
          targetLabel: args.name,
          payload: {
            name: args.name,
            ...(args.notes !== undefined ? { notes: args.notes } : {}),
            ...(args.assigneeGid ? { assigneeGid: args.assigneeGid } : {}),
            ...(args.dueOn ? { dueOn: args.dueOn } : {}),
          },
        });
        return proposed(change);
      }),
  );

  server.registerTool(
    'asana_link_task',
    {
      title: 'Propose linking a task to a CMS entity (needs approval)',
      description:
        'Propose linking (or unlinking) a tracked task to a CMS entity (page / meta / schema) so an SEO fix is traceable. Stages a PENDING proposal.',
      inputSchema: {
        siteId: siteIdField,
        taskGid: taskGidField,
        entityType: z.union([z.enum(['page', 'meta', 'schema']), z.null()]).describe('null to unlink.'),
        entityId: z.union([z.string(), z.null()]).describe('CMS entity id, or null to unlink.'),
      },
      annotations: { readOnlyHint: false, openWorldHint: false },
    },
    async (args) =>
      guard(async () => {
        const change = await client.createChange(site(args.siteId), {
          module: 'asana',
          action: 'asana.link',
          targetType: 'task',
          targetId: args.taskGid,
          payload: { entityType: args.entityType ?? null, entityId: args.entityId ?? null },
        });
        return proposed(change);
      }),
  );
}
