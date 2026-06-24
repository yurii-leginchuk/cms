import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { Site } from '../sites/site.entity';
import { BrandCard } from '../sites/brand-card.entity';
import { SiteImage, ImageAltStatus, ImageAltSource } from './site-image.entity';
import { ImagePlacement } from './image-placement.entity';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../token-usage/token-usage.service';
import { buildGroundingContext } from '../schema/schema-analysis';
import { checkFaithfulness } from '../agent/tools/proposal-validation';
import { needsAlt } from './alt-quality';

const MAX_ALT_CHARS = 125;
const MIN_CONTEXT_CHARS = 40; // below this, AI is guessing → needsReview

/**
 * Build the grounding context block from an image's placements: nearest
 * headings, captions, surrounding text, and page titles across every page it
 * appears on. This is what the alt is grounded in — reproducible, captured at
 * scrape time, and what `checkFaithfulness` checks against.
 */
function placementContext(placements: ImagePlacement[]): { text: string; quotes: string[] } {
  const quotes: string[] = [];
  const parts: string[] = [];
  for (const p of placements.slice(0, 6)) {
    if (p.nearestHeading) {
      parts.push(`Section heading: ${p.nearestHeading}`);
      quotes.push(p.nearestHeading);
    }
    if (p.caption) {
      parts.push(`Figure caption: ${p.caption}`);
      quotes.push(p.caption);
    }
    if (p.surroundingText) {
      parts.push(`Surrounding text: ${p.surroundingText}`);
      quotes.push(p.surroundingText.slice(0, 160));
    }
  }
  return { text: parts.join('\n'), quotes: quotes.filter(Boolean) };
}

interface AltGen {
  alt: string;
  decorative: boolean;
  rationale: string;
}

@Injectable()
export class ImageAiService {
  private readonly logger = new Logger(ImageAiService.name);

  constructor(
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(BrandCard) private readonly cardRepo: Repository<BrandCard>,
    @InjectRepository(SiteImage) private readonly imageRepo: Repository<SiteImage>,
    @InjectRepository(ImagePlacement)
    private readonly placementRepo: Repository<ImagePlacement>,
    private readonly settingsService: SettingsService,
    private readonly tokenUsageService: TokenUsageService,
  ) {}

  /** Generate a grounded alt suggestion for one image (→ ai_suggested). */
  async generateForImage(siteId: string, imageId: string): Promise<SiteImage> {
    const apiKey = await this.settingsService.getRaw('openai_api_key');
    if (!apiKey) {
      throw new BadRequestException('OpenAI API key not configured. Add it in Settings.');
    }
    // ALT text uses its own dedicated model setting (a cheap "mini" model is
    // plenty for short, grounded descriptions). Falls back to the general model,
    // then to gpt-4o-mini.
    const model =
      (await this.settingsService.getRaw('openai_alt_model')) ??
      (await this.settingsService.getRaw('openai_model')) ??
      'gpt-4o-mini';

    const image = await this.imageRepo.findOne({ where: { id: imageId, siteId } });
    if (!image) throw new NotFoundException('Image not found');

    const placements = await this.placementRepo.find({
      where: { imageId },
      relations: { page: true },
    });
    const card = await this.cardRepo.findOne({ where: { siteId } });

    const ctx = placementContext(placements);
    const pageTitles = [
      ...new Set(placements.map((p) => p.page?.metaTitle || p.page?.h1Text).filter(Boolean)),
    ].join('; ');
    const thinContext = ctx.text.trim().length < MIN_CONTEXT_CHARS;

    // When we couldn't find where the image is used (no placement / no
    // surrounding text), fall back to LOOKING at the image itself with a vision
    // model and describing what's actually in it. Only possible for a publicly
    // fetchable http(s) URL; otherwise we degrade to the text-only path.
    const canSeeImage = /^https?:\/\//i.test(image.canonicalUrl);
    let usedVision = false;
    let gen: AltGen;
    if (thinContext && canSeeImage) {
      try {
        gen = await this.callOpenAiVision(apiKey, model, siteId, {
          imageUrl: image.canonicalUrl,
          pageTitles,
        });
        usedVision = true;
      } catch (err) {
        this.logger.warn(
          `Vision alt failed for image ${image.id}, falling back to text: ${(err as Error).message}`,
        );
        gen = await this.callOpenAi(apiKey, model, siteId, {
          fileName: image.canonicalUrl,
          contextText: ctx.text,
          pageTitles,
        });
      }
    } else {
      gen = await this.callOpenAi(apiKey, model, siteId, {
        fileName: image.canonicalUrl,
        contextText: ctx.text,
        pageTitles,
      });
    }

    // Grounding: faithfulness against the Brand Card allow-list (neverSay = hard
    // fail, ungrounded offerings = advisory) — the SAME discipline as schema/meta.
    const grounding = buildGroundingContext(
      [ctx.text, pageTitles].join('\n'),
      card,
    );
    const faith = checkFaithfulness(gen.alt, grounding);

    image.draftAlt = gen.decorative ? '' : gen.alt;
    image.decorative = gen.decorative;
    image.aiRationale = gen.rationale;
    // Evidence = the page context quotes; if the alt was described straight from
    // the image (no page found), record that as the provenance instead.
    image.evidence = usedVision
      ? ['(described from the image itself — not found used on any page)']
      : ctx.quotes.slice(0, 5);
    image.unverifiedClaims = faith.faithful
      ? faith.unsupportedOfferings
      : [`Forbidden term(s): ${faith.forbiddenHits.join(', ')}`, ...faith.unsupportedOfferings];
    // A hard faithfulness fail or an over-length alt always forces review. Thin
    // page context forces review ONLY when we couldn't see the image — a vision
    // description IS grounded (in the pixels), so it doesn't need the thin-context flag.
    image.needsReview =
      (thinContext && !usedVision) || !faith.faithful || gen.alt.length > MAX_ALT_CHARS;
    image.source = ImageAltSource.AI_GENERATED;
    image.status = ImageAltStatus.AI_SUGGESTED;

    return this.imageRepo.save(image);
  }

  /** Bulk: generate for every image still needing alt. Resilient per-image. */
  async generateForMissing(
    siteId: string,
  ): Promise<{ generated: number; failed: number; needsReview: number }> {
    const candidates = await this.imageRepo.find({
      where: { siteId, status: In([ImageAltStatus.SYNCED]) },
    });
    const missing = candidates.filter(
      (i) => needsAlt(i.observedQuality) && !i.decorative,
    );

    let generated = 0;
    let failed = 0;
    let needsReview = 0;
    for (const img of missing) {
      try {
        const saved = await this.generateForImage(siteId, img.id);
        generated++;
        if (saved.needsReview) needsReview++;
      } catch (err) {
        failed++;
        this.logger.warn(
          `Alt generation failed for image ${img.id}: ${(err as Error).message}`,
        );
      }
    }
    return { generated, failed, needsReview };
  }

  // ── OpenAI call (mirrors ai.service.generateMeta) ──────────────────────────

  private async callOpenAi(
    apiKey: string,
    model: string,
    siteId: string,
    vars: { fileName: string; contextText: string; pageTitles: string },
  ): Promise<AltGen> {
    const prompt = this.buildPrompt(vars);
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are an accessibility and SEO expert writing image alt text. Always respond with valid JSON.',
            },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      );

      const content = response.data.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(content);

      this.tokenUsageService
        .record({
          siteId,
          feature: 'alt_generation',
          model,
          inputTokens: response.data.usage?.prompt_tokens ?? 0,
          outputTokens: response.data.usage?.completion_tokens ?? 0,
        })
        .catch(() => {/* non-critical */});

      let alt = String(parsed.alt ?? '').trim();
      if (alt.length > MAX_ALT_CHARS) alt = alt.slice(0, MAX_ALT_CHARS).trim();
      return {
        alt,
        decorative: parsed.decorative === true,
        rationale: String(parsed.rationale ?? '').slice(0, 500),
      };
    } catch (err) {
      if (err instanceof AxiosError) {
        if (err.response?.status === 401) throw new BadRequestException('Invalid OpenAI API key.');
        const message = err.response?.data?.error?.message ?? err.message;
        throw new ServiceUnavailableException(`OpenAI API error: ${message}`);
      }
      throw new ServiceUnavailableException(`Failed to generate alt: ${(err as Error).message}`);
    }
  }

  // ── OpenAI vision call (no page context → describe the image itself) ────────

  private async callOpenAiVision(
    apiKey: string,
    model: string,
    siteId: string,
    vars: { imageUrl: string; pageTitles: string },
  ): Promise<AltGen> {
    const prompt = this.buildVisionPrompt(vars);
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are an accessibility and SEO expert writing image alt text. You describe ONLY what is visibly present in the image. Always respond with valid JSON.',
            },
            {
              role: 'user',
              content: [
                { type: 'text', text: prompt },
                // detail:'low' keeps cost/latency down — alt text needs the gist, not fine detail.
                { type: 'image_url', image_url: { url: vars.imageUrl, detail: 'low' } },
              ],
            },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.4,
        },
        {
          headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: 30000,
        },
      );

      const content = response.data.choices?.[0]?.message?.content ?? '{}';
      const parsed = JSON.parse(content);

      this.tokenUsageService
        .record({
          siteId,
          feature: 'alt_generation',
          model,
          inputTokens: response.data.usage?.prompt_tokens ?? 0,
          outputTokens: response.data.usage?.completion_tokens ?? 0,
        })
        .catch(() => {/* non-critical */});

      let alt = String(parsed.alt ?? '').trim();
      if (alt.length > MAX_ALT_CHARS) alt = alt.slice(0, MAX_ALT_CHARS).trim();
      return {
        alt,
        decorative: parsed.decorative === true,
        rationale: String(parsed.rationale ?? '').slice(0, 500),
      };
    } catch (err) {
      if (err instanceof AxiosError) {
        if (err.response?.status === 401) throw new BadRequestException('Invalid OpenAI API key.');
        const message = err.response?.data?.error?.message ?? err.message;
        throw new ServiceUnavailableException(`OpenAI vision API error: ${message}`);
      }
      throw new ServiceUnavailableException(`Failed to generate alt (vision): ${(err as Error).message}`);
    }
  }

  private buildVisionPrompt(vars: { imageUrl: string; pageTitles: string }): string {
    return [
      'We could not determine which page this image is used on, so describe the',
      'image directly from what you can SEE in it. Write an SEO-friendly,',
      'accessible ALT text.',
      '',
      vars.pageTitles ? 'POSSIBLY RELATED PAGE(S): ' + vars.pageTitles : '',
      '',
      'RULES (strict):',
      '- Describe only what is actually visible. Do NOT invent brand names, people,',
      '  prices, locations, or claims you cannot see in the image.',
      '- Keep it concise: 5–15 words, hard max 125 characters.',
      '- Do NOT start with "image of", "picture of", "photo of", "graphic of".',
      '- You CAN see the image — describe what is actually in it. Only set',
      '  decorative=true if the image is genuinely empty/non-informative: a blank or',
      '  solid-color block, a thin divider line, or a pure spacer. ANY real content',
      '  (photo, illustration, logo, icon with meaning, diagram, UI/graphic) is NOT',
      '  decorative — describe it instead.',
      '- If text is legibly shown in the image, you may include it verbatim.',
      '',
      'Respond as JSON: {"alt": string, "decorative": boolean, "rationale": string}.',
      'rationale = one sentence on what you saw in the image.',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }

  private buildPrompt(vars: { fileName: string; contextText: string; pageTitles: string }): string {
    return [
      'Write an SEO-friendly, accessible ALT text for an image, using ONLY the context provided.',
      '',
      'IMAGE FILE: ' + vars.fileName,
      vars.pageTitles ? 'USED ON PAGE(S): ' + vars.pageTitles : '',
      '',
      'CONTEXT (surrounding text / headings / captions where the image appears):',
      vars.contextText || '(no surrounding text was captured)',
      '',
      'RULES (strict):',
      '- Describe what the image plausibly shows, grounded in the context. Do NOT invent',
      '  brand names, services, people, prices, locations, or claims not present above.',
      '- Keep it concise: 5–15 words, hard max 125 characters.',
      '- Do NOT start with "image of", "picture of", "photo of", "graphic of".',
      '- Do NOT keyword-stuff. Describe the image, not the page\'s target keyword.',
      '- Missing or thin surrounding text is NOT evidence that an image is decorative.',
      '  NEVER mark an image decorative just because context is sparse. Only set',
      '  decorative=true when the image is POSITIVELY non-informative: a spacer,',
      '  a horizontal divider rule, a solid/blank background, or a tiny icon that sits',
      '  right next to a text label that already conveys the meaning.',
      '- A photo, illustration, logo, diagram, product shot, or any content graphic',
      '  (e.g. a file named like a design export) is NOT decorative — describe it.',
      '- If you cannot tell exactly what the image shows from the context, write a',
      '  cautious, generic-but-truthful description (e.g. based on the file name and',
      '  page topic) and DO NOT fabricate specifics. Do NOT fall back to decorative.',
      '',
      'Respond as JSON: {"alt": string, "decorative": boolean, "rationale": string}.',
      'rationale = one sentence on what context you grounded the alt in.',
    ]
      .filter((l) => l !== '')
      .join('\n');
  }
}
