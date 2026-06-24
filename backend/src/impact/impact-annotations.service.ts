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
    date: string,
    label: string,
    pageId?: string | null,
  ): Promise<ImpactAnnotation> {
    return this.repo.save(
      this.repo.create({ siteId, date, label: label.slice(0, 200), pageId: pageId ?? null }),
    );
  }

  async remove(siteId: string, id: string): Promise<{ ok: true }> {
    const res = await this.repo.delete({ id, siteId });
    if (!res.affected) throw new NotFoundException('Annotation not found');
    return { ok: true };
  }
}
