import {
  Controller,
  Get,
  Put,
  Delete,
  Param,
  Body,
  Query,
} from '@nestjs/common';
import { PromptsService } from './prompts.service';
import { UpsertPromptDto } from './dto/upsert-prompt.dto';

@Controller('prompts')
export class PromptsController {
  constructor(private readonly promptsService: PromptsService) {}

  @Get()
  findAll(@Query('siteId') siteId?: string) {
    return this.promptsService.findAll(siteId);
  }

  @Get('sites/:siteId')
  findForSite(@Param('siteId') siteId: string) {
    return this.promptsService.findAll(siteId);
  }

  @Put(':slug')
  upsert(@Param('slug') slug: string, @Body() dto: UpsertPromptDto) {
    return this.promptsService.upsert(slug, dto);
  }

  @Put('sites/:siteId/:slug')
  upsertForSite(
    @Param('siteId') siteId: string,
    @Param('slug') slug: string,
    @Body() dto: UpsertPromptDto,
  ) {
    return this.promptsService.upsert(slug, dto, siteId);
  }

  @Delete('sites/:siteId/:slug')
  resetForSite(
    @Param('siteId') siteId: string,
    @Param('slug') slug: string,
  ) {
    return this.promptsService.resetToDefault(slug, siteId);
  }
}
