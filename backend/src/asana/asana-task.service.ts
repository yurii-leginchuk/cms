import { Injectable, BadRequestException, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AsanaTask } from './asana-task.entity';
import { AsanaConnectionService } from './asana-connection.service';
import { AsanaProjectService } from './asana-project.service';
import { AsanaSyncService } from './asana-sync.service';
import { AsanaApiClient, AsanaError } from './asana-api-client';
import { mapTaskToMirror, parseAsanaTaskGid } from './asana-helpers';

export interface ListTasksParams {
  page?: number;
  limit?: number;
  search?: string;
  section?: string;
  assignee?: string;
  completed?: boolean;
  linkedOnly?: boolean;
  aiOnly?: boolean;
}

export interface TaskListResult {
  data: AsanaTask[];
  meta: { page: number; limit: number; total: number; totalPages: number };
}

export interface TaskDetail {
  task: AsanaTask;
  subtasks: AsanaTask[];
}

/**
 * Reads the mirror for the Task Monitoring page (fast, filterable). The mirror
 * holds ONLY tasks the CMS created (origin `cms`/`mcp`) — not the whole Asana
 * project. Phase 1 is read-only; the detail view re-hydrates the tracked task
 * live and fetches its subtasks live (subtasks are NOT persisted, so the mirror
 * stays limited to CMS-owned top-level tasks).
 */
@Injectable()
export class AsanaTaskService {
  constructor(
    @InjectRepository(AsanaTask)
    private readonly taskRepo: Repository<AsanaTask>,
    private readonly connection: AsanaConnectionService,
    private readonly projects: AsanaProjectService,
    private readonly sync: AsanaSyncService,
    private readonly api: AsanaApiClient,
  ) {}

  /**
   * Adopt an existing Asana task (created outside the CMS) for tracking, from a
   * pasted task URL or raw GID. The task must belong to the site's mapped
   * project; it lands in the mirror with origin `tracked` and is refreshed by
   * "Sync now" like any CMS task.
   */
  async trackByUrl(siteId: string, url: string): Promise<AsanaTask> {
    const map = await this.projects.requireProject(siteId);
    const gid = parseAsanaTaskGid(url);
    if (!gid) {
      throw new BadRequestException("Couldn't find an Asana task id in that URL.");
    }
    const token = await this.connection.getToken();
    let raw;
    try {
      raw = await this.api.getTask(token, gid);
    } catch (e) {
      if (e instanceof AsanaError && e.status === 404) {
        throw new NotFoundException("That Asana task doesn't exist, or the token can't access it.");
      }
      throw e;
    }
    const inProject = (raw.memberships ?? []).some((m) => m.project?.gid === map.projectGid);
    if (!inProject) {
      throw new BadRequestException(
        `That task isn't in this site's Asana project${map.projectName ? ` (${map.projectName})` : ''}.`,
      );
    }
    return this.sync.upsertTracked(raw, siteId, map.projectGid!, 'tracked');
  }

  /** Paginated, filtered list of a site's TOP-LEVEL mirrored tasks. */
  async list(siteId: string, params: ListTasksParams): Promise<TaskListResult> {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(200, Math.max(1, params.limit ?? 50));

    const qb = this.taskRepo
      .createQueryBuilder('t')
      .where('t.siteId = :siteId', { siteId })
      .andWhere('t.parentTaskGid IS NULL');

    if (params.section) qb.andWhere('t.sectionGid = :section', { section: params.section });
    if (params.assignee) qb.andWhere('t.assigneeGid = :assignee', { assignee: params.assignee });
    if (params.completed !== undefined) {
      qb.andWhere('t.completed = :completed', { completed: params.completed });
    }
    if (params.linkedOnly) qb.andWhere('t.linkedEntityType IS NOT NULL');
    if (params.aiOnly) qb.andWhere('t.origin = :mcp', { mcp: 'mcp' });
    if (params.search) {
      qb.andWhere(
        new Brackets((b) => {
          b.where('t.name ILIKE :q', { q: `%${params.search}%` }).orWhere(
            't.assigneeName ILIKE :q',
            { q: `%${params.search}%` },
          );
        }),
      );
    }

    // Incomplete first, then most-recently modified in Asana.
    qb.orderBy('t.completed', 'ASC')
      .addOrderBy('t.asanaModifiedAt', 'DESC', 'NULLS LAST')
      .skip((page - 1) * limit)
      .take(limit);

    const [data, total] = await qb.getManyAndCount();
    return {
      data,
      meta: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }

  /**
   * Task detail: re-hydrate the (CMS-tracked) task LIVE from Asana so it's fresh,
   * and fetch its subtasks LIVE. If the task is tracked, its mirror row is
   * updated; subtasks are returned as transient (non-persisted) views so the
   * mirror stays limited to CMS-owned top-level tasks.
   */
  async getDetail(siteId: string, taskGid: string): Promise<TaskDetail> {
    const map = await this.projects.requireProject(siteId);
    const token = await this.connection.getToken();

    const raw = await this.api.getTask(token, taskGid);
    const fields = mapTaskToMirror(raw, siteId, map.projectGid!);

    const existing = await this.taskRepo.findOne({ where: { siteId, taskGid } });
    let task: AsanaTask;
    if (existing) {
      Object.assign(existing, fields, { lastSyncedAt: new Date() });
      task = await this.taskRepo.save(existing);
    } else {
      // Not a CMS-tracked task — a transient read-only view (never persisted).
      task = this.taskRepo.create({ ...fields, origin: 'asana', lastSyncedAt: new Date() });
    }

    const subtaskRaws = await this.api.listSubtasks(token, taskGid);
    const subtasks = subtaskRaws.map((st) =>
      this.taskRepo.create({ ...mapTaskToMirror(st, siteId, map.projectGid!), origin: 'asana' }),
    );

    return { task, subtasks };
  }

  // ── Phase 2: writes ─────────────────────────────────────────────────────────

  /** Load a tracked mirror row or throw — writes only apply to tracked tasks. */
  private async requireTracked(siteId: string, taskGid: string): Promise<AsanaTask> {
    const row = await this.taskRepo.findOne({ where: { siteId, taskGid } });
    if (!row) throw new NotFoundException('This task is not tracked by the CMS.');
    return row;
  }

  /** Stop tracking a task in the CMS (removes the mirror row; does NOT touch Asana). */
  async untrack(siteId: string, taskGid: string): Promise<{ untracked: true; taskGid: string }> {
    const row = await this.requireTracked(siteId, taskGid);
    await this.taskRepo.delete({ id: row.id });
    return { untracked: true, taskGid };
  }

  /** Create a task in the site's mapped project (origin `cms`). */
  async createTask(
    siteId: string,
    dto: {
      name: string;
      notes?: string;
      assigneeGid?: string;
      dueOn?: string;
      sectionGid?: string;
    },
  ): Promise<AsanaTask> {
    const map = await this.projects.requireProject(siteId);
    const token = await this.connection.getToken();
    let raw = await this.api.createTask(token, {
      projectGid: map.projectGid!,
      name: dto.name,
      notes: dto.notes,
      assigneeGid: dto.assigneeGid,
      dueOn: dto.dueOn,
    });
    if (dto.sectionGid) {
      await this.api.addTaskToSection(token, dto.sectionGid, raw.gid);
      raw = await this.api.getTask(token, raw.gid);
    }
    return this.sync.upsertTracked(raw, siteId, map.projectGid!, 'cms');
  }

  /** Update a tracked task's name/notes/due/completed. */
  async updateTask(
    siteId: string,
    taskGid: string,
    dto: { name?: string; notes?: string; dueOn?: string | null; completed?: boolean },
  ): Promise<AsanaTask> {
    const row = await this.requireTracked(siteId, taskGid);
    const token = await this.connection.getToken();
    const raw = await this.api.updateTask(token, taskGid, dto);
    return this.sync.upsertTracked(raw, siteId, row.projectGid, row.origin);
  }

  /** Move a tracked task to a section (status), optionally toggling completed. */
  async setStatus(
    siteId: string,
    taskGid: string,
    dto: { sectionGid: string; completed?: boolean },
  ): Promise<AsanaTask> {
    const row = await this.requireTracked(siteId, taskGid);
    const token = await this.connection.getToken();
    if (dto.completed !== undefined) {
      await this.api.updateTask(token, taskGid, { completed: dto.completed });
    }
    await this.api.addTaskToSection(token, dto.sectionGid, taskGid);
    const raw = await this.api.getTask(token, taskGid);
    return this.sync.upsertTracked(raw, siteId, row.projectGid, row.origin);
  }

  /** Set or clear a tracked task's assignee. */
  async setAssignee(
    siteId: string,
    taskGid: string,
    assigneeGid: string | null,
  ): Promise<AsanaTask> {
    const row = await this.requireTracked(siteId, taskGid);
    const token = await this.connection.getToken();
    const raw = await this.api.updateTask(token, taskGid, { assigneeGid });
    return this.sync.upsertTracked(raw, siteId, row.projectGid, row.origin);
  }

  /**
   * Create a subtask under a tracked task. Subtasks aren't mirrored, so we return
   * the refreshed parent (its numSubtasks) plus a transient view of the subtask.
   */
  async createSubtask(
    siteId: string,
    parentGid: string,
    dto: { name: string; notes?: string; assigneeGid?: string; dueOn?: string },
  ): Promise<{ parent: AsanaTask; subtask: AsanaTask }> {
    const row = await this.requireTracked(siteId, parentGid);
    const token = await this.connection.getToken();
    const subRaw = await this.api.createSubtask(token, parentGid, dto);
    const parentRaw = await this.api.getTask(token, parentGid);
    const parent = await this.sync.upsertTracked(parentRaw, siteId, row.projectGid, row.origin);
    const subtask = this.taskRepo.create({
      ...mapTaskToMirror(subRaw, siteId, row.projectGid),
      origin: 'asana',
    });
    return { parent, subtask };
  }

  /** Link (or unlink, with nulls) a tracked task to a CMS entity. CMS-only. */
  async linkEntity(
    siteId: string,
    taskGid: string,
    dto: { entityType: string | null; entityId: string | null },
  ): Promise<AsanaTask> {
    const row = await this.requireTracked(siteId, taskGid);
    if ((dto.entityType === null) !== (dto.entityId === null)) {
      throw new BadRequestException('Provide both entityType and entityId, or null for both.');
    }
    row.linkedEntityType = dto.entityType;
    row.linkedEntityId = dto.entityId;
    return this.taskRepo.save(row);
  }
}
