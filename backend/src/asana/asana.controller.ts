import {
  Controller,
  Get,
  Put,
  Post,
  Delete,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { AsanaConnectionService } from './asana-connection.service';
import { AsanaProjectService } from './asana-project.service';
import { UpdateConnectionDto } from './dto/update-connection.dto';
import { SetWorkspaceDto } from './dto/set-workspace.dto';

/**
 * Global Asana connection + discovery endpoints. Responses are wrapped in
 * `{ data }` by TransformInterceptor; the `/api` prefix is global. Everything
 * sits behind the ApiKeyGuard (AUTH_ENFORCE). Secrets are redacted in responses.
 */
@Controller('asana')
export class AsanaController {
  constructor(
    private readonly connection: AsanaConnectionService,
    private readonly projects: AsanaProjectService,
  ) {}

  /** Redacted connection status (patSet, workspace, verification). */
  @Get('connection')
  getConnection() {
    return this.connection.getPublic();
  }

  /** Set/replace the PAT (write-only; response redacts it). */
  @Put('connection')
  setConnection(@Body() dto: UpdateConnectionDto) {
    return this.connection.setPat(dto);
  }

  /** Remove the token and everything derived from it. */
  @Delete('connection')
  disconnect() {
    return this.connection.disconnect();
  }

  /** Validate the stored token → returns connection + available workspaces. */
  @Post('connection/verify')
  @HttpCode(HttpStatus.OK)
  verify() {
    return this.connection.verify();
  }

  /** Pin the workspace the connection operates in. */
  @Put('connection/workspace')
  setWorkspace(@Body() dto: SetWorkspaceDto) {
    return this.connection.setWorkspace(dto);
  }

  @Get('workspaces')
  workspaces() {
    return this.connection.listWorkspaces();
  }

  /** Projects in the pinned workspace (for site→project mapping). */
  @Get('projects')
  listProjects() {
    return this.projects.listProjects();
  }

  /** Workspace users (assignee picker). */
  @Get('users')
  listUsers() {
    return this.projects.listUsers();
  }
}
