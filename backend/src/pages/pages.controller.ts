import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Body,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { PagesService } from './pages.service';
import { UpdatePageMetaDto } from './dto/update-page-meta.dto';

@Controller('sites/:siteId/pages')
export class PagesController {
  constructor(private readonly pagesService: PagesService) {}

  @Get()
  findBySite(
    @Param('siteId') siteId: string,
    @Query('page') page = '1',
    @Query('limit') limit = '50',
    @Query('search') search = '',
    @Query('sort') sort = 'url_asc',
  ) {
    return this.pagesService.findBySite(
      siteId,
      parseInt(page, 10),
      parseInt(limit, 10),
      search,
      sort,
    );
  }

  @Patch(':pageId')
  updateMeta(
    @Param('pageId') pageId: string,
    @Body() dto: UpdatePageMetaDto,
  ) {
    return this.pagesService.updateMeta(pageId, dto);
  }

  @Get(':pageId/history')
  findHistory(@Param('pageId') pageId: string) {
    return this.pagesService.findHistory(pageId);
  }

  @Get(':pageId')
  findOne(@Param('pageId') pageId: string) {
    return this.pagesService.findOneLite(pageId);
  }

  @Post(':pageId/generate-meta')
  @HttpCode(HttpStatus.OK)
  generateMeta(
    @Param('siteId') siteId: string,
    @Param('pageId') pageId: string,
    @Body() body: { promptSlug?: string },
  ) {
    return this.pagesService.generateMeta(siteId, pageId, body.promptSlug);
  }
}
