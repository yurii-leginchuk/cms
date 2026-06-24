import {
  Controller,
  Get,
  Post,
  Put,
  Patch,
  Delete,
  Param,
  Body,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { SitesService } from './sites.service';
import { BrandCardService } from './brand-card.service';
import { BrandCard } from './brand-card.entity';
import { CreateSiteDto } from './dto/create-site.dto';
import { UpdateSiteDto } from './dto/update-site.dto';
import { UpsertSiteBriefDto } from './dto/upsert-site-brief.dto';

@Controller('sites')
export class SitesController {
  constructor(
    private readonly sitesService: SitesService,
    private readonly brandCardService: BrandCardService,
  ) {}

  @Get()
  findAll() {
    return this.sitesService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.sitesService.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSiteDto) {
    return this.sitesService.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSiteDto) {
    return this.sitesService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string) {
    return this.sitesService.remove(id);
  }

  @Post(':id/parse')
  @HttpCode(HttpStatus.ACCEPTED)
  triggerParse(@Param('id') id: string) {
    this.sitesService.triggerParse(id);
    return { message: 'Parsing started' };
  }

  @Get(':id/wp-status')
  checkWpStatus(@Param('id') id: string) {
    return this.sitesService.checkWpStatus(id);
  }

  @Get(':id/brief')
  getBrief(@Param('id') id: string) {
    return this.sitesService.getBrief(id);
  }

  @Put(':id/brief')
  upsertBrief(@Param('id') id: string, @Body() dto: UpsertSiteBriefDto) {
    return this.sitesService.upsertBrief(id, dto);
  }

  // ── Brand Card (structured site ground truth) ──────────────────────────────
  @Get(':id/brand-card')
  getBrandCard(@Param('id') id: string) {
    return this.brandCardService.get(id);
  }

  // Auto-derive a draft Brand Card from already-crawled pages.
  @Post(':id/brand-card/derive')
  deriveBrandCard(@Param('id') id: string, @Body() body: { force?: boolean }) {
    return this.brandCardService.deriveDraft(id, body?.force ?? false);
  }

  // Save human edits (and mark reviewed via the payload).
  @Put(':id/brand-card')
  upsertBrandCard(@Param('id') id: string, @Body() dto: Partial<BrandCard>) {
    return this.brandCardService.upsert(id, dto);
  }
}
