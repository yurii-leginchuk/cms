import {
  Injectable,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import axios, { AxiosError } from 'axios';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../token-usage/token-usage.service';
import { SiteBrief } from '../sites/site-brief.entity';

function resolveTemplate(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{([^}]+)\}\}/g, (_, key: string) => vars[key.trim()] ?? '');
}

function buildBriefContext(b: SiteBrief): string {
  const parts: string[] = ['\n\n--- SITE BRIEF (use this context when writing meta) ---'];
  if (b.spellingVariant) parts.push(`Spelling convention: ${b.spellingVariant}`);
  if (b.locations) parts.push(`Target locations: ${b.locations}`);
  if (b.approvedCtas) parts.push(`Approved CTAs / phone numbers: ${b.approvedCtas}`);
  if (b.complianceNotes) parts.push(`Compliance notes: ${b.complianceNotes}`);
  if (b.clientNotes) parts.push(`Client notes: ${b.clientNotes}`);
  if (b.keywordCsv) parts.push(`Target keywords (CSV): ${b.keywordCsv}`);
  parts.push('--- END BRIEF ---');
  return parts.join('\n');
}

export interface GenerateMetaResult {
  metaTitle: string | null;
  metaDescription: string | null;
  tokensUsed: number;
}

@Injectable()
export class AiService {
  constructor(
    private readonly settingsService: SettingsService,
    private readonly tokenUsageService: TokenUsageService,
  ) {}

  async generateMeta(
    pageVars: {
      url: string;
      cleanContent: string | null;
      metaTitle: string | null;
      metaDescription: string | null;
    },
    siteVars: { name: string; url: string },
    promptContent: string,
    modelOverride?: string | null,
    siteId?: string,
    brief?: SiteBrief,
  ): Promise<GenerateMetaResult> {
    const apiKey = await this.settingsService.getRaw('openai_api_key');
    if (!apiKey) {
      throw new BadRequestException('OpenAI API key not configured. Add it in Settings.');
    }

    const model = modelOverride || ((await this.settingsService.getRaw('openai_model')) ?? 'gpt-4o-mini');

    const templateVars: Record<string, string> = {
      'site.name': siteVars.name,
      'site.url': siteVars.url,
      'page.url': pageVars.url,
      'page.cleanContent': pageVars.cleanContent ?? '',
      'page.metaTitle': pageVars.metaTitle ?? '',
      'page.metaDescription': pageVars.metaDescription ?? '',
    };

    const briefContext = brief ? buildBriefContext(brief) : '';
    const resolvedPrompt = resolveTemplate(promptContent, templateVars) + briefContext;

    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content: 'You are an SEO expert. Always respond with valid JSON.',
            },
            {
              role: 'user',
              content: resolvedPrompt,
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.7,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 30000,
        },
      );

      const content = response.data.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(content);
      const inputTokens: number = response.data.usage?.prompt_tokens ?? 0;
      const outputTokens: number = response.data.usage?.completion_tokens ?? 0;
      const tokensUsed = inputTokens + outputTokens;

      this.tokenUsageService.record({
        siteId: siteId ?? null,
        feature: 'meta_generation',
        model,
        inputTokens,
        outputTokens,
      }).catch(() => {/* non-critical */});

      return {
        metaTitle: parsed.metaTitle ?? null,
        metaDescription: parsed.metaDescription ?? null,
        tokensUsed,
      };
    } catch (err) {
      if (err instanceof AxiosError) {
        if (err.response?.status === 401) {
          throw new BadRequestException('Invalid OpenAI API key.');
        }
        const message = err.response?.data?.error?.message ?? err.message;
        throw new ServiceUnavailableException(`OpenAI API error: ${message}`);
      }
      throw new ServiceUnavailableException(`Failed to generate meta: ${(err as Error).message}`);
    }
  }
}
