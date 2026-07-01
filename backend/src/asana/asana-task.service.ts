import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
import { AsanaTask } from './asana-task.entity';
import { AsanaConnectionService } from './asana-connection.service';
import { AsanaProjectService } from './asana-project.service';
import { AsanaSyncService } from './asana-sync.service';
import { AsanaApiClient } from './asana-api-client';

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
 * Reads the mirror for the Task Monitoring page (fast, filterable). Phase 1 is
 * read-only; the detail view hydrates a single task live from Asana so an opened
 * task is always fresh, then upserts the mirror.
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
   * Task detail: hydrate the task + its subtasks LIVE from Asana (so an opened
   * task is fresh), upsert them into the mirror, and return the mirror rows.
   */
  async getDetail(siteId: string, taskGid: string): Promise<TaskDetail> {
    const map = await this.projects.requireProject(siteId);
    const token = await this.connection.getToken();

    const raw = await this.api.getTask(token, taskGid);
    const task = await this.sync.upsertTask(raw, siteId, map.projectGid!);

    const subtaskRaws = await this.api.listSubtasks(token, taskGid);
    const subtasks: AsanaTask[] = [];
    for (const st of subtaskRaws) {
      subtasks.push(await this.sync.upsertTask(st, siteId, map.projectGid!));
    }

    if (!task) throw new NotFoundException('Task not found');
    return { task, subtasks };
  }
}
