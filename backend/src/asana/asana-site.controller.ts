import {
  Controller,
  Get,
  Put,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AsanaProjectService } from './asana-project.service';
import { AsanaSyncService } from './asana-sync.service';
import { AsanaTaskService } from './asana-task.service';
import { SetMappingDto } from './dto/set-mapping.dto';
import { TrackTaskDto } from './dto/track-task.dto';

/**
 * Per-site Asana endpoints (mapping, sections, sync, task reads). Phase 1 is
 * read-only for tasks; writes + webhooks arrive in later phases.
 */
@Controller('sites/:siteId/asana')
export class AsanaSiteController {
  constructor(
    private readonly projects: AsanaProjectService,
    private readonly sync: AsanaSyncService,
    private readonly tasks: AsanaTaskService,
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

  /** Task detail (+ subtasks), hydrated live from Asana. */
  @Get('tasks/:taskGid')
  getTask(@Param('siteId') siteId: string, @Param('taskGid') taskGid: string) {
    return this.tasks.getDetail(siteId, taskGid);
  }
}
