import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Param,
  Query,
  Body,
  Inject,
  Res,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { Response } from 'express';
import { BriefsService } from './briefs.service';
import { CreateBriefDto } from './dto/create-brief.dto';
import { UpdateBriefDto } from './dto/update-brief.dto';
import { Brief } from './brief.entity';
import { BriefExporter, BRIEF_EXPORTER } from './export/brief-exporter';

// briefType is derived from pageId, not a stored column.
function withBriefType(brief: Brief) {
  return {
    ...brief,
    briefType: brief.pageId ? 'existing_page_rewrite' : 'new_page_draft',
  };
}

@Controller('sites/:siteId/briefs')
export class BriefsController {
  constructor(
    private readonly service: BriefsService,
    @Inject(BRIEF_EXPORTER) private readonly exporter: BriefExporter,
  ) {}

  @Post()
  async create(@Param('siteId') siteId: string, @Body() dto: CreateBriefDto) {
    return withBriefType(await this.service.create(siteId, dto));
  }

  @Get()
  async findBySite(@Param('siteId') siteId: string, @Query('pageId') pageId?: string) {
    const briefs = await this.service.findBySite(siteId, pageId);
    return briefs.map(withBriefType);
  }

  @Get(':id')
  async findOne(@Param('siteId') siteId: string, @Param('id') id: string) {
    return withBriefType(await this.service.findOne(siteId, id));
  }

  @Patch(':id')
  async update(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Body() dto: UpdateBriefDto,
  ) {
    return withBriefType(await this.service.update(siteId, id, dto));
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('siteId') siteId: string, @Param('id') id: string) {
    return this.service.remove(siteId, id);
  }

  /**
   * Export a brief. Primary path is a .docx download (binary — uses @Res() to
   * bypass the global transform interceptor). When a Google Docs folder is
   * configured the exporter returns a {kind:'gdoc',url} which we wrap in the
   * standard {data} envelope by hand.
   */
  @Post(':id/export')
  async export(
    @Param('siteId') siteId: string,
    @Param('id') id: string,
    @Res() res: Response,
  ) {
    const brief = await this.service.findOne(siteId, id);
    const result = await this.exporter.export(brief);

    if (result.kind === 'docx') {
      res.set({
        'Content-Type':
          'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': `attachment; filename="${result.filename}"`,
      });
      res.end(result.buffer);
      return;
    }

    res.json({ data: { url: result.url } });
  }
}
