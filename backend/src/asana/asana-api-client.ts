import { Injectable, Logger } from '@nestjs/common';
import axios, { AxiosError, Method } from 'axios';
import {
  shouldRetry,
  nextBackoffMs,
  mapAsanaError,
  collectPaginated,
  buildTaskData,
  type AsanaPage,
  type AsanaTaskRaw,
  type TaskWriteInput,
} from './asana-helpers';

const ASANA_BASE = 'https://app.asana.com/api/1.0';
const MAX_RETRIES = 4;
const TIMEOUT_MS = 20_000;

/** opt_fields requested for a task, so section/assignee/subtasks come back inline. */
const TASK_FIELDS =
  'name,notes,completed,due_on,permalink_url,num_subtasks,modified_at,' +
  'assignee.name,parent.gid,memberships.project.gid,memberships.section.name';

export interface AsanaUser {
  gid: string;
  name: string;
}
export interface AsanaWorkspace {
  gid: string;
  name: string;
}
export interface AsanaProject {
  gid: string;
  name: string;
}
export interface AsanaSection {
  gid: string;
  name: string;
}

/** A failed Asana call, carrying the (scrubbed) reason + HTTP status. */
export class AsanaError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = 'AsanaError';
  }
}

/**
 * Thin, stateless wrapper over the Asana REST API. The decrypted PAT is passed
 * per call and never stored on the instance. Responsibilities: Bearer auth,
 * `{data}` unwrap, opaque-offset pagination, 429/`Retry-After` backoff, and
 * error scrubbing (the token/body are NEVER logged).
 */
@Injectable()
export class AsanaApiClient {
  private readonly logger = new Logger('AsanaApiClient');

  /** One raw request with retry/backoff. Returns the full `{ data, next_page }` envelope. */
  private async raw<T>(
    token: string,
    method: Method,
    path: string,
    opts: { params?: Record<string, unknown>; data?: unknown } = {},
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        const res = await axios.request<T>({
          baseURL: ASANA_BASE,
          url: path,
          method,
          headers: { Authorization: `Bearer ${token}` },
          params: opts.params,
          data: opts.data,
          timeout: TIMEOUT_MS,
        });
        return res.data;
      } catch (e) {
        const err = e as AxiosError<{ errors?: { message?: string }[] }>;
        const status = err.response?.status;
        const retryAfter = err.response?.headers?.['retry-after'] as string | undefined;
        if (status && shouldRetry(status, attempt, MAX_RETRIES)) {
          await this.sleep(nextBackoffMs(attempt, retryAfter));
          continue;
        }
        // Scrub: only the mapped reason is surfaced/logged — never the token/body.
        const apiMsg = err.response?.data?.errors?.[0]?.message;
        const reason = mapAsanaError(status, apiMsg);
        this.logger.warn(`Asana ${method} ${path} failed (${status ?? 'network'})`);
        throw new AsanaError(reason, status);
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((r) => setTimeout(r, ms));
  }

  /** GET a single object's `data`. */
  private async getOne<T>(token: string, path: string, params?: Record<string, unknown>): Promise<T> {
    const env = await this.raw<{ data: T }>(token, 'GET', path, { params });
    return env.data;
  }

  /** GET a full list, walking pagination. */
  private async getList<T>(
    token: string,
    path: string,
    params?: Record<string, unknown>,
  ): Promise<T[]> {
    return collectPaginated<T>((offset) =>
      this.raw<AsanaPage<T>>(token, 'GET', path, {
        params: { limit: 100, ...params, offset },
      }),
    );
  }

  // ── Connection / discovery ──────────────────────────────────────────────────

  /** Validate the token and return the identity + available workspaces. */
  async verify(token: string): Promise<{ user: AsanaUser; workspaces: AsanaWorkspace[] }> {
    const user = await this.getOne<AsanaUser>(token, '/users/me', { opt_fields: 'name' });
    const workspaces = await this.getList<AsanaWorkspace>(token, '/workspaces', {
      opt_fields: 'name',
    });
    return { user, workspaces };
  }

  listWorkspaces(token: string): Promise<AsanaWorkspace[]> {
    return this.getList<AsanaWorkspace>(token, '/workspaces', { opt_fields: 'name' });
  }

  listProjects(token: string, workspaceGid: string): Promise<AsanaProject[]> {
    return this.getList<AsanaProject>(token, '/projects', {
      workspace: workspaceGid,
      archived: false,
      opt_fields: 'name',
    });
  }

  getProject(token: string, projectGid: string): Promise<AsanaProject> {
    return this.getOne<AsanaProject>(token, `/projects/${projectGid}`, { opt_fields: 'name' });
  }

  listUsers(token: string, workspaceGid: string): Promise<AsanaUser[]> {
    return this.getList<AsanaUser>(token, '/users', {
      workspace: workspaceGid,
      opt_fields: 'name',
    });
  }

  listSections(token: string, projectGid: string): Promise<AsanaSection[]> {
    return this.getList<AsanaSection>(token, `/projects/${projectGid}/sections`, {
      opt_fields: 'name',
    });
  }

  // ── Tasks (read) ────────────────────────────────────────────────────────────

  /** Every (incomplete + completed) top-level task in a project, fully hydrated. */
  listProjectTasks(token: string, projectGid: string): Promise<AsanaTaskRaw[]> {
    return this.getList<AsanaTaskRaw>(token, `/projects/${projectGid}/tasks`, {
      opt_fields: TASK_FIELDS,
    });
  }

  getTask(token: string, taskGid: string): Promise<AsanaTaskRaw> {
    return this.getOne<AsanaTaskRaw>(token, `/tasks/${taskGid}`, { opt_fields: TASK_FIELDS });
  }

  listSubtasks(token: string, taskGid: string): Promise<AsanaTaskRaw[]> {
    return this.getList<AsanaTaskRaw>(token, `/tasks/${taskGid}/subtasks`, {
      opt_fields: TASK_FIELDS,
    });
  }

  // ── Tasks (write) ───────────────────────────────────────────────────────────
  // Asana write bodies are wrapped in `{ data: {...} }`; responses come back as
  // `{ data: task }`. opt_fields (as a query param) hydrates the returned task.

  private async writeTask(
    token: string,
    method: Method,
    path: string,
    data: Record<string, unknown>,
  ): Promise<AsanaTaskRaw> {
    const env = await this.raw<{ data: AsanaTaskRaw }>(token, method, path, {
      params: { opt_fields: TASK_FIELDS },
      data: { data },
    });
    return env.data;
  }

  createTask(
    token: string,
    input: TaskWriteInput & { projectGid: string },
  ): Promise<AsanaTaskRaw> {
    const { projectGid, ...fields } = input;
    return this.writeTask(token, 'POST', '/tasks', {
      ...buildTaskData(fields),
      projects: [projectGid],
    });
  }

  updateTask(token: string, taskGid: string, input: TaskWriteInput): Promise<AsanaTaskRaw> {
    return this.writeTask(token, 'PUT', `/tasks/${taskGid}`, buildTaskData(input));
  }

  createSubtask(
    token: string,
    parentGid: string,
    input: TaskWriteInput,
  ): Promise<AsanaTaskRaw> {
    return this.writeTask(token, 'POST', `/tasks/${parentGid}/subtasks`, buildTaskData(input));
  }

  /** Move a task into a section (this is how "set status" works). */
  async addTaskToSection(token: string, sectionGid: string, taskGid: string): Promise<void> {
    await this.raw(token, 'POST', `/sections/${sectionGid}/addTask`, {
      data: { data: { task: taskGid } },
    });
  }
}
