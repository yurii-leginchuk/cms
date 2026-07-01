import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AsanaTask } from './asana-task.entity';
import { AsanaConnectionService } from './asana-connection.service';
import { AsanaProjectService } from './asana-project.service';
import { AsanaApiClient } from './asana-api-client';
import { mapTaskToMirror } from './asana-helpers';

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
    private readonly api: AsanaApiClient,
  ) {}

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
}
