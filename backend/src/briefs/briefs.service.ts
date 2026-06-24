import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Brief } from './brief.entity';
import { CreateBriefDto } from './dto/create-brief.dto';
import { UpdateBriefDto } from './dto/update-brief.dto';

@Injectable()
export class BriefsService {
  constructor(
    @InjectRepository(Brief)
    private readonly repo: Repository<Brief>,
  ) {}

  async create(siteId: string, dto: CreateBriefDto): Promise<Brief> {
    const brief = this.repo.create({
      siteId,
      name: dto.name ?? null,
      pageId: dto.pageId ?? null,
      pageUrl: dto.pageUrl,
      proposedMetaTitle: dto.proposedMetaTitle ?? null,
      proposedMetaDescription: dto.proposedMetaDescription ?? null,
      proposedSlug: dto.proposedSlug ?? null,
      proposedContent: dto.proposedContent ?? null,
      proposedSchema: dto.proposedSchema ?? null,
      keywordStrategy: dto.keywordStrategy ?? null,
      internalLinks: dto.internalLinks ?? null,
      recommendations: dto.recommendations ?? null,
      status: 'draft',
    });
    return this.repo.save(brief);
  }

  async findBySite(siteId: string, pageId?: string): Promise<Brief[]> {
    const where: Record<string, unknown> = { siteId };
    if (pageId) where.pageId = pageId;
    return this.repo.find({ where, order: { createdAt: 'DESC' }, take: 100 });
  }

  async findOne(siteId: string, id: string): Promise<Brief> {
    const brief = await this.repo.findOne({ where: { id, siteId } });
    if (!brief) throw new NotFoundException('Brief not found');
    return brief;
  }

  /**
   * Full-field partial merge: apply every defined key from the DTO (ignore
   * undefined keys so the caller can patch any subset), then save.
   */
  async update(siteId: string, id: string, dto: UpdateBriefDto): Promise<Brief> {
    const brief = await this.findOne(siteId, id);
    for (const [key, value] of Object.entries(dto)) {
      if (value !== undefined) {
        (brief as unknown as Record<string, unknown>)[key] = value;
      }
    }

    // Keep status and appliedAt consistent: 'applied' requires a date; any other
    // status clears it so a stale applied-date can't linger on a draft.
    if (brief.status === 'applied') {
      if (!brief.appliedAt) {
        throw new BadRequestException(
          'appliedAt is required when status is "applied"',
        );
      }
    } else {
      brief.appliedAt = null;
    }

    return this.repo.save(brief);
  }

  async remove(siteId: string, id: string): Promise<void> {
    const brief = await this.findOne(siteId, id);
    await this.repo.remove(brief);
  }

  async countBySite(siteId: string): Promise<number> {
    return this.repo.count({ where: { siteId } });
  }
}
