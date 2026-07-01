import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ImpactAnnotation } from './impact-annotation.entity';

@Injectable()
export class ImpactAnnotationsService {
  constructor(
    @InjectRepository(ImpactAnnotation)
    private readonly repo: Repository<ImpactAnnotation>,
  ) {}

  list(siteId: string): Promise<ImpactAnnotation[]> {
    return this.repo.find({ where: { siteId }, order: { date: 'DESC' } });
  }

  create(
    siteId: string,
    input: { date: string; label: string; pageId?: string | null; type?: string | null; link?: string | null },
  ): Promise<ImpactAnnotation> {
    return this.repo.save(
      this.repo.create({
        siteId,
        date: input.date,
        label: input.label.slice(0, 200),
        pageId: input.pageId ?? null,
        type: input.type?.slice(0, 32) ?? null,
        link: input.link?.slice(0, 1024) ?? null,
      }),
    );
  }

  async update(
    siteId: string,
    id: string,
    patch: { date?: string; label?: string; pageId?: string | null; type?: string | null; link?: string | null },
  ): Promise<ImpactAnnotation> {
    const row = await this.repo.findOne({ where: { id, siteId } });
    if (!row) throw new NotFoundException('Annotation not found');
    if (patch.date !== undefined) row.date = patch.date;
    if (patch.label !== undefined) row.label = patch.label.slice(0, 200);
    if (patch.pageId !== undefined) row.pageId = patch.pageId;
    if (patch.type !== undefined) row.type = patch.type?.slice(0, 32) ?? null;
    if (patch.link !== undefined) row.link = patch.link?.slice(0, 1024) ?? null;
    return this.repo.save(row);
  }

  async remove(siteId: string, id: string): Promise<{ ok: true }> {
    const res = await this.repo.delete({ id, siteId });
    if (!res.affected) throw new NotFoundException('Annotation not found');
    return { ok: true };
  }
}
