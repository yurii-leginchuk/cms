import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TokenUsage, TokenFeature } from './token-usage.entity';
import { SettingsService } from '../settings/settings.service';

/** USD per 1M tokens — input / output */
const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'gpt-4o-mini':            { input: 0.15,  output: 0.60  },
  'gpt-4o':                 { input: 5.00,  output: 15.00 },
  'gpt-4o-2024-08-06':      { input: 2.50,  output: 10.00 },
  'gpt-4o-2024-11-20':      { input: 2.50,  output: 10.00 },
  'gpt-4-turbo':            { input: 10.00, output: 30.00 },
  'gpt-3.5-turbo':          { input: 0.50,  output: 1.50  },
  'jina-reader':             { input: 0,     output: 0     },
};

function calcCost(model: string, inputTokens: number, outputTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['gpt-4o-mini'];
  return (inputTokens * pricing.input + outputTokens * pricing.output) / 1_000_000;
}

export interface RecordUsageDto {
  siteId?: string | null;
  feature: TokenFeature;
  model: string;
  inputTokens: number;
  outputTokens: number;
}

export interface UsageStats {
  totalTokens: number;
  totalCostUsd: number;
  byFeature: { feature: string; tokens: number; costUsd: number; calls: number }[];
  byModel: { model: string; tokens: number; costUsd: number; calls: number }[];
  daily: { date: string; tokens: number; costUsd: number }[];
  jinaQuota: { remaining: number; limit: number } | null;
}

@Injectable()
export class TokenUsageService {
  constructor(
    @InjectRepository(TokenUsage)
    private readonly repo: Repository<TokenUsage>,
    private readonly settingsService: SettingsService,
  ) {}

  async record(dto: RecordUsageDto): Promise<void> {
    const totalTokens = dto.inputTokens + dto.outputTokens;
    const estimatedCostUsd = calcCost(dto.model, dto.inputTokens, dto.outputTokens);
    await this.repo.save(
      this.repo.create({
        siteId: dto.siteId ?? null,
        feature: dto.feature,
        model: dto.model,
        inputTokens: dto.inputTokens,
        outputTokens: dto.outputTokens,
        totalTokens,
        estimatedCostUsd,
      }),
    );
  }

  async getStats(options: { days?: number; siteId?: string }): Promise<UsageStats> {
    const { days, siteId } = options;

    const qb = this.repo.createQueryBuilder('u');
    if (siteId) qb.andWhere('u.siteId = :siteId', { siteId });
    if (days) {
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      qb.andWhere('u.createdAt >= :since', { since });
    }

    const rows = await qb.getMany();

    const totalTokens = rows.reduce((s, r) => s + r.totalTokens, 0);
    const totalCostUsd = rows.reduce((s, r) => s + Number(r.estimatedCostUsd), 0);

    // By feature
    const featureMap = new Map<string, { tokens: number; costUsd: number; calls: number }>();
    for (const r of rows) {
      const cur = featureMap.get(r.feature) ?? { tokens: 0, costUsd: 0, calls: 0 };
      featureMap.set(r.feature, {
        tokens: cur.tokens + r.totalTokens,
        costUsd: cur.costUsd + Number(r.estimatedCostUsd),
        calls: cur.calls + 1,
      });
    }
    const byFeature = Array.from(featureMap.entries()).map(([feature, v]) => ({ feature, ...v }));

    // By model
    const modelMap = new Map<string, { tokens: number; costUsd: number; calls: number }>();
    for (const r of rows) {
      const cur = modelMap.get(r.model) ?? { tokens: 0, costUsd: 0, calls: 0 };
      modelMap.set(r.model, {
        tokens: cur.tokens + r.totalTokens,
        costUsd: cur.costUsd + Number(r.estimatedCostUsd),
        calls: cur.calls + 1,
      });
    }
    const byModel = Array.from(modelMap.entries()).map(([model, v]) => ({ model, ...v }));

    // Daily
    const dayMap = new Map<string, { tokens: number; costUsd: number }>();
    for (const r of rows) {
      const date = r.createdAt.toISOString().slice(0, 10);
      const cur = dayMap.get(date) ?? { tokens: 0, costUsd: 0 };
      dayMap.set(date, {
        tokens: cur.tokens + r.totalTokens,
        costUsd: cur.costUsd + Number(r.estimatedCostUsd),
      });
    }
    const daily = Array.from(dayMap.entries())
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    // Jina quota — free tier is 10M tokens; we track cumulative usage
    const JINA_FREE_LIMIT = 10_000_000;
    const jinaUsedRaw = await this.settingsService.getRaw('jina_tokens_used');
    const jinaQuota = jinaUsedRaw !== null
      ? {
          remaining: Math.max(0, JINA_FREE_LIMIT - parseInt(jinaUsedRaw, 10)),
          limit: JINA_FREE_LIMIT,
        }
      : null;

    return { totalTokens, totalCostUsd, byFeature, byModel, daily, jinaQuota };
  }
}
