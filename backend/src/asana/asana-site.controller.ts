import {
  Controller,
  Get,
  Put,
  Post,
  Patch,
  Delete,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AsanaProjectService } from './asana-project.service';
import { AsanaSyncService } from './asana-sync.service';
import { AsanaTaskService } from './asana-task.service';
import { AsanaWebhookService } from './asana-webhook.service';
import { SetMappingDto } from './dto/set-mapping.dto';
import { TrackTaskDto } from './dto/track-task.dto';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { SetStatusDto } from './dto/set-status.dto';
import { SetAssigneeDto } from './dto/set-assignee.dto';
import { CreateSubtaskDto } from './dto/create-subtask.dto';
import { LinkEntityDto } from './dto/link-entity.dto';

/**
 * Per-site Asana endpoints: mapping, sections, sync, task reads (Phase 1) and
 * task writes — create/update/status/assignee/subtasks/link + untrack (Phase 2).
 * Webhooks + gated MCP arrive in Phase 3.
 */
@Controller('sites/:siteId/asana')
export class AsanaSiteController {
  constructor(
    private readonly projects: AsanaProjectService,
    private readonly sync: AsanaSyncService,
    private readonly tasks: AsanaTaskService,
    private readonly webhook: AsanaWebhookService,
  ) {}

  @Get('mapping')
  getMapping(@Param('siteId') siteId: string) {
    return this.projects.getMappingPublic(siteId);
  }

  @Put('mapping')
  setMapping(@Param('siteId') siteId: string, @Body() dto: SetMappingDto) {
    return this.projects.setProject(siteId, dto);
  }

  /** Project sections = the available status columns. */
  @Get('sections')
  sections(@Param('siteId') siteId: string) {
    return this.projects.listSections(siteId);
  }

  /** Refresh the CMS-tracked tasks for this site ("Sync now"). */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  syncNow(@Param('siteId') siteId: string) {
    return this.sync.refreshTrackedTasks(siteId);
  }

  /** Establish the Asana webhook for live status sync (needs a public URL). */
  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  establishWebhook(@Param('siteId') siteId: string) {
    return this.webhook.establish(siteId);
  }

  /** Remove the Asana webhook. */
  @Delete('webhook')
  removeWebhook(@Param('siteId') siteId: string) {
    return this.webhook.remove(siteId);
  }

  /** Paginated, filtered mirror list. */
  @Get('tasks')
  listTasks(
    @Param('siteId') siteId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('search') search = '',
    @Query('section') section = '',
    @Query('assignee') assignee = '',
    @Query('completed') completed = '',
    @Query('linkedOnly') linkedOnly = '',
    @Query('aiOnly') aiOnly = '',
  ) {
    return this.tasks.list(siteId, {
      page: parseInt(page, 10) || 1,
      limit: parseInt(limit, 10) || 50,
      search: search || undefined,
      section: section || undefined,
      assignee: assignee || undefined,
      completed: completed === '' ? undefined : completed === 'true',
      linkedOnly: linkedOnly === 'true',
      aiOnly: aiOnly === 'true',
    });
  }

  /** Adopt an existing Asana task (created outside the CMS) for tracking. */
  @Post('tasks/track')
  @HttpCode(HttpStatus.OK)
  trackTask(@Param('siteId') siteId: string, @Body() dto: TrackTaskDto) {
    return this.tasks.trackByUrl(siteId, dto.url);
  }

  /** Create a task in the site's mapped project. */
  @Post('tasks')
  @HttpCode(HttpStatus.OK)
  createTask(@Param('siteId') siteId: string, @Body() dto: CreateTaskDto) {
    return this.tasks.createTask(siteId, dto);
  }

  /** Task detail (+ subtasks), hydrated live from Asana. */
  @Get('tasks/:taskGid')
  getTask(@Param('siteId') siteId: string, @Param('taskGid') taskGid: string) {
    return this.tasks.getDetail(siteId, taskGid);
  }

  /** Update name/notes/due/completed on a tracked task. */
  @Patch('tasks/:taskGid')
  updateTask(
    @Param('siteId') siteId: string,
    @Param('taskGid') taskGid: string,
    @Body() dto: UpdateTaskDto,
  ) {
    return this.tasks.updateTask(siteId, taskGid, dto);
  }

  /** Stop tracking a task in the CMS (does NOT delete it in Asana). */
  @Delete('tasks/:taskGid')
  untrackTask(@Param('siteId') siteId: string, @Param('taskGid') taskGid: string) {
    return this.tasks.untrack(siteId, taskGid);
  }

  /** Move a task to a section (status), optionally toggling completed. */
  @Post('tasks/:taskGid/status')
  @HttpCode(HttpStatus.OK)
  setStatus(
    @Param('siteId') siteId: string,
    @Param('taskGid') taskGid: string,
    @Body() dto: SetStatusDto,
  ) {
    return this.tasks.setStatus(siteId, taskGid, dto);
  }

  /** Set or clear a task's assignee. */
  @Post('tasks/:taskGid/assignee')
  @HttpCode(HttpStatus.OK)
  setAssignee(
    @Param('siteId') siteId: string,
    @Param('taskGid') taskGid: string,
    @Body() dto: SetAssigneeDto,
  ) {
    return this.tasks.setAssignee(siteId, taskGid, dto.assigneeGid);
  }

  /** Create a subtask under a tracked task. */
  @Post('tasks/:taskGid/subtasks')
  @HttpCode(HttpStatus.OK)
  createSubtask(
    @Param('siteId') siteId: string,
    @Param('taskGid') taskGid: string,
    @Body() dto: CreateSubtaskDto,
  ) {
    return this.tasks.createSubtask(siteId, taskGid, dto);
  }

  /** Link (or unlink, with nulls) a task to a CMS entity. */
  @Post('tasks/:taskGid/link')
  @HttpCode(HttpStatus.OK)
  linkEntity(
    @Param('siteId') siteId: string,
    @Param('taskGid') taskGid: string,
    @Body() dto: LinkEntityDto,
  ) {
    return this.tasks.linkEntity(siteId, taskGid, dto);
  }
}
