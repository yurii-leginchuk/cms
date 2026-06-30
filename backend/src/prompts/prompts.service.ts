import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AiPrompt } from './prompt.entity';
import { UpsertPromptDto } from './dto/upsert-prompt.dto';

const DEFAULT_PROMPTS: Array<{
  slug: string;
  name: string;
  description: string;
  content: string;
}> = [
  {
    slug: 'meta_generator',
    name: 'Meta Generator (Title + Description)',
    description: 'Generates both meta title and meta description in one call.',
    content: `You are an expert SEO copywriter. Generate an optimized meta title and meta description for the following web page.

Website: {{site.name}} — {{site.url}}
Page URL: {{page.url}}

Page content:
---
{{page.cleanContent}}
---

Requirements:
- Meta title: 50–60 characters, include the primary keyword naturally
- Meta description: 120–160 characters, summarize the page value, include a call-to-action

Return only valid JSON, no commentary:
{"metaTitle": "...", "metaDescription": "..."}`,
  },
  {
    slug: 'meta_title',
    name: 'Meta Title Generator',
    description: 'Generates only the meta title.',
    content: `You are an expert SEO copywriter. Generate an optimized meta title for the following web page.

Website: {{site.name}} — {{site.url}}
Page URL: {{page.url}}

Page content:
---
{{page.cleanContent}}
---

Requirements: 50–60 characters, include the primary keyword naturally, be descriptive and click-worthy.

Return only valid JSON:
{"metaTitle": "..."}`,
  },
  {
    slug: 'meta_description',
    name: 'Meta Description Generator',
    description: 'Generates only the meta description.',
    content: `You are an expert SEO copywriter. Generate an optimized meta description for the following web page.

Website: {{site.name}} — {{site.url}}
Page URL: {{page.url}}

Page content:
---
{{page.cleanContent}}
---

Requirements: 120–160 characters, summarize the page value, include a call-to-action.

Return only valid JSON:
{"metaDescription": "..."}`,
  },
];

@Injectable()
export class PromptsService implements OnModuleInit {
  constructor(
    @InjectRepository(AiPrompt)
    private readonly promptRepo: Repository<AiPrompt>,
  ) {}

  async onModuleInit(): Promise<void> {
    for (const defaults of DEFAULT_PROMPTS) {
      const existing = await this.promptRepo.findOne({
        where: { slug: defaults.slug, siteId: null },
      });
      if (!existing) {
        await this.promptRepo.save(
          this.promptRepo.create({
            ...defaults,
            siteId: null,
            isDefault: true,
          }),
        );
      }
    }
  }

  async findAll(siteId?: string): Promise<AiPrompt[]> {
    // Get all global prompts
    const globals = await this.promptRepo.find({
      where: { siteId: null },
      order: { slug: 'ASC' },
    });

    if (!siteId) {
      return globals;
    }

    // Get site-specific overrides
    const siteSpecific = await this.promptRepo.find({
      where: { siteId },
      order: { slug: 'ASC' },
    });

    // For each slug, use site-specific if available
    const siteMap = new Map(siteSpecific.map((p) => [p.slug, p]));
    return globals.map((g) => siteMap.get(g.slug) ?? g);
  }

  async findEffective(slug: string, siteId?: string): Promise<AiPrompt> {
    if (siteId) {
      const sitePrompt = await this.promptRepo.findOne({
        where: { slug, siteId },
      });
      if (sitePrompt) return sitePrompt;
    }

    const global = await this.promptRepo.findOne({
      where: { slug, siteId: null },
    });
    if (!global) throw new NotFoundException(`Prompt "${slug}" not found`);
    return global;
  }

  async upsert(slug: string, dto: UpsertPromptDto, siteId?: string): Promise<AiPrompt> {
    const existing = await this.promptRepo.findOne({
      where: { slug, siteId: siteId ?? null },
    });

    if (existing) {
      Object.assign(existing, {
        content: dto.content,
        ...(dto.name !== undefined && { name: dto.name }),
        ...(dto.description !== undefined && { description: dto.description }),
        ...('model' in dto && { model: dto.model ?? null }),
      });
      return this.promptRepo.save(existing);
    }

    // For new site-specific prompts, inherit name/description from global if not provided
    let name = dto.name;
    let description = dto.description;
    if (!name || description === undefined) {
      const global = await this.promptRepo.findOne({
        where: { slug, siteId: null },
      });
      if (global) {
        name = name ?? global.name;
        description = description ?? global.description;
      }
    }

    return this.promptRepo.save(
      this.promptRepo.create({
        slug,
        name: name ?? slug,
        description: description ?? null,
        content: dto.content,
        model: dto.model ?? null,
        siteId: siteId ?? null,
        isDefault: false,
      }),
    );
  }

  async resetToDefault(slug: string, siteId: string): Promise<void> {
    await this.promptRepo.delete({ slug, siteId });
  }
}
