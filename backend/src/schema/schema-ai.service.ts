import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import axios, { AxiosError } from 'axios';
import { Page } from '../pages/page.entity';
import { Site } from '../sites/site.entity';
import { BrandCard } from '../sites/brand-card.entity';
import { SiteBrief } from '../sites/site-brief.entity';
import { PageSchema, PageSchemaStatus } from './page-schema.entity';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../token-usage/token-usage.service';
import { detectSchemas } from './schema-validator';
import { prunePageHtml } from './html-prune';
import {
  buildGroundingContext,
  buildSchemaBlock,
  groundProposal,
  RawSchemaProposal,
  SchemaProposal,
} from './schema-analysis';

/** Flatten the Site Brief's verified factual fields into a labelled text block.
 * Returns '' when there is no brief / no usable fields. Mirrors the meta
 * generator's brief context so schema generation shares the same client facts. */
function briefFacts(brief: SiteBrief | null): string {
  if (!brief) return '';
  const parts: string[] = [];
  if (brief.locations) parts.push(`Target locations: ${brief.locations}`);
  if (brief.approvedCtas)
    parts.push(`Approved CTAs / phone numbers: ${brief.approvedCtas}`);
  if (brief.spellingVariant)
    parts.push(`Spelling convention: ${brief.spellingVariant}`);
  if (brief.complianceNotes)
    parts.push(`Compliance notes: ${brief.complianceNotes}`);
  if (brief.clientNotes) parts.push(`Client notes: ${brief.clientNotes}`);
  if (brief.keywordCsv)
    parts.push(`Target keywords (CSV): ${brief.keywordCsv}`);
  return parts.join('\n');
}

@Injectable()
export class SchemaAiService {
  private readonly logger = new Logger(SchemaAiService.name);

  constructor(
    @InjectRepository(Page) private readonly pageRepo: Repository<Page>,
    @InjectRepository(Site) private readonly siteRepo: Repository<Site>,
    @InjectRepository(BrandCard) private readonly cardRepo: Repository<BrandCard>,
    @InjectRepository(SiteBrief)
    private readonly briefRepo: Repository<SiteBrief>,
    @InjectRepository(PageSchema)
    private readonly managedRepo: Repository<PageSchema>,
    private readonly settingsService: SettingsService,
    private readonly tokenUsageService: TokenUsageService,
  ) {}

  /**
   * One grounded pass: propose NEW schema, FIX invalid existing schema, and flag
   * DRIFT (schema field ≠ page content). Proposals are ephemeral — the human
   * approves/edits them, which persists a PageSchema (see SchemaService.createManaged).
   */
  async analyze(siteId: string, pageId: string): Promise<{ proposals: SchemaProposal[] }> {
    const page = await this.pageRepo.findOne({ where: { id: pageId } });
    if (!page) throw new NotFoundException('Page not found');

    const apiKey = await this.settingsService.getRaw('openai_api_key');
    if (!apiKey) {
      throw new BadRequestException('OpenAI API key not configured. Add it in Settings.');
    }
    const model =
      (await this.settingsService.getRaw('openai_model')) ?? 'gpt-4o-mini';

    const site = await this.siteRepo.findOne({ where: { id: siteId } });
    const card = await this.cardRepo.findOne({ where: { siteId } });
    const brief = await this.briefRepo.findOne({ where: { siteId } });

    const detected =
      page.detectedSchemas ?? detectSchemas(page.rawHtml ?? '');
    // CMS-managed set = the source of truth. Includes `modified` rows that are
    // not yet published (so absent from detected/live HTML). The model must use
    // THIS to know what already exists, not the live detection alone.
    const managed = (
      await this.managedRepo.find({ where: { pageId }, order: { createdAt: 'ASC' } })
    ).filter((m) => m.status !== PageSchemaStatus.REMOVED);
    const content = page.cleanContent ?? '';
    // Structure-preserving view: microdata, tel:/mailto:, <time>, <address>,
    // og: meta — signals markdown drops, used to ground field values.
    const prunedHtml = prunePageHtml(page.rawHtml ?? '');

    const prompt = this.buildPrompt({
      url: page.url,
      siteName: site?.name ?? '',
      h1: page.h1Text,
      metaTitle: page.customMetaTitle ?? page.metaTitle,
      content,
      prunedHtml,
      existingSchemas: detected.schemas.map((s) => ({
        scriptIndex: s.scriptIndex,
        nodeIndex: s.nodeIndex,
        type: s.type,
        validity: s.validity,
        json: s.json,
      })),
      managedSchemas: managed.map((m) => ({
        managedId: m.id,
        type: m.type,
        status: m.status,
        validity: m.validationStatus,
        json: m.jsonld,
      })),
      card,
      brief,
    });

    let parsed: { proposals?: RawSchemaProposal[] };
    try {
      const response = await axios.post(
        'https://api.openai.com/v1/chat/completions',
        {
          model,
          messages: [
            {
              role: 'system',
              content:
                'You are a structured-data (schema.org / JSON-LD) expert. ' +
                'You only assert facts present in the supplied page content or ' +
                'verified brand facts. Always respond with valid JSON.',
            },
            { role: 'user', content: prompt },
          ],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        },
        {
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          timeout: 60000,
        },
      );

      const raw = response.data.choices?.[0]?.message?.content ?? '{}';
      parsed = JSON.parse(raw);

      this.tokenUsageService
        .record({
          siteId,
          feature: 'schema_generation',
          model,
          inputTokens: response.data.usage?.prompt_tokens ?? 0,
          outputTokens: response.data.usage?.completion_tokens ?? 0,
        })
        .catch(() => {
          /* non-critical */
        });
    } catch (err) {
      if (err instanceof AxiosError) {
        if (err.response?.status === 401)
          throw new BadRequestException('Invalid OpenAI API key.');
        const message = err.response?.data?.error?.message ?? err.message;
        throw new ServiceUnavailableException(`OpenAI API error: ${message}`);
      }
      throw new ServiceUnavailableException(
        `Failed to analyze schema: ${(err as Error).message}`,
      );
    }

    // Ground faithfulness against the markdown, the pruned HTML, AND the site
    // brief (verified client facts: locations, approved CTAs/phone numbers,
    // client notes) — so schema values pulled from the brief count as backed,
    // not flagged as unverified.
    const ctx = buildGroundingContext(
      `${content}\n${prunedHtml}\n${briefFacts(brief)}`,
      card,
    );
    const rawProposals = Array.isArray(parsed.proposals) ? parsed.proposals : [];
    const proposals = rawProposals.map((rp) => {
      // `before` = the current version this proposal would replace. The CMS
      // MANAGED row is the source of truth, so for fix/drift resolve it from
      // managed: by explicit targetManagedId, else by matching @type. Only fall
      // back to the detected live block when nothing is managed. This keeps the
      // before/after diff honest even when the model omits targetManagedId.
      let before: unknown | null = null;
      if (rp.kind !== 'add') {
        const byId = rp.targetManagedId
          ? managed.find((m) => m.id === rp.targetManagedId)
          : undefined;
        const byType = managed.find(
          (m) => m.type.toLowerCase() === (rp.type ?? '').toLowerCase(),
        );
        before =
          byId?.jsonld ??
          byType?.jsonld ??
          (rp.targetScriptIndex != null
            ? (detected.schemas.find(
                (s) =>
                  s.scriptIndex === rp.targetScriptIndex &&
                  s.nodeIndex === (rp.targetNodeIndex ?? 0),
              )?.json ?? null)
            : null);
        // When we resolved a managed row, make the proposal point at it so the
        // UI offers replace-vs-add against the right row.
        if (!rp.targetManagedId && (byId ?? byType)) {
          rp.targetManagedId = (byId ?? byType)!.id;
        }
      }
      return groundProposal(rp, ctx, before);
    });

    this.logger.log(
      `Schema analysis for ${page.url}: ${proposals.length} proposal(s) ` +
        `(${proposals.filter((p) => p.forbidden).length} forbidden)`,
    );
    return { proposals };
  }

  private buildPrompt(ctx: {
    url: string;
    siteName: string;
    h1: string | null;
    metaTitle: string | null;
    content: string;
    prunedHtml: string;
    existingSchemas: unknown[];
    managedSchemas: {
      managedId: string;
      type: string;
      status: string;
      validity: string;
      json: unknown;
    }[];
    card: BrandCard | null;
    brief: SiteBrief | null;
  }): string {
    const brandFacts = ctx.card
      ? JSON.stringify(
          {
            brandName: ctx.card.brandName,
            services: ctx.card.services,
            locations: ctx.card.locations,
            people: ctx.card.people,
            approvedClaims: ctx.card.approvedClaims,
            neverSay: ctx.card.neverSay,
            ctas: ctx.card.ctas,
          },
          null,
          2,
        )
      : '(no Brand Card — rely on page content only)';

    // Every schema is serialized IN FULL (compact JSON, one per line) — no
    // truncation, so the model always sees the complete existing FAQPage (etc.)
    // to count edits correctly and to honour the DEDUP rule.
    const existing =
      buildSchemaBlock(
        ctx.existingSchemas.map((s) => {
          const { json, ...label } = s as Record<string, unknown>;
          return { label, json };
        }),
      ) || '(none detected on the live page)';

    const managedSet =
      buildSchemaBlock(
        ctx.managedSchemas.map((m) => ({
          label: {
            managedId: m.managedId,
            type: m.type,
            status: m.status,
            validity: m.validity,
          },
          json: m.json,
        })),
      ) || '(no schemas managed in the CMS for this page yet)';

    const siteBrief = briefFacts(ctx.brief) || '(no Site Brief on file)';

    return [
      `You are auditing structured data for this page and proposing improvements.`,
      ``,
      `PAGE URL: ${ctx.url}`,
      `SITE: ${ctx.siteName}`,
      `H1: ${ctx.h1 ?? '(none)'}`,
      `META TITLE: ${ctx.metaTitle ?? '(none)'}`,
      ``,
      `--- PAGE CONTENT (the ONLY allowed source of facts, plus brand facts below) ---`,
      ctx.content || '(no content captured)',
      `--- END PAGE CONTENT ---`,
      ``,
      `--- VERIFIED BRAND FACTS (allow-list) ---`,
      brandFacts,
      `--- END BRAND FACTS ---`,
      ``,
      `--- SITE BRIEF (verified client context — allow-list, same authority as brand facts) ---`,
      siteBrief,
      `--- END SITE BRIEF ---`,
      ``,
      `--- EXISTING JSON-LD ON THE PAGE (detected on the LIVE page) ---`,
      existing,
      `--- END EXISTING JSON-LD ---`,
      ``,
      `--- CMS-MANAGED SCHEMAS (the SOURCE OF TRUTH — what the CMS already manages for this page) ---`,
      `One schema per line as: {managedId,type,status,validity} <full JSON-LD>. NOTE: rows with status`,
      `"modified" are pending publish, so they may NOT appear in the detected live JSON-LD above — they`,
      `still EXIST. Each schema is shown IN FULL — treat the JSON you see as the complete current state.`,
      managedSet,
      `--- END CMS-MANAGED SCHEMAS ---`,
      ``,
      `--- PAGE HTML (pruned: semantic tags + microdata + links/alt/datetime; styles & scripts removed) ---`,
      ctx.prunedHtml || '(no HTML captured)',
      `--- END PAGE HTML ---`,
      ``,
      `GROUNDING CONTRACT (mandatory):`,
      `- Use ONLY facts present in PAGE CONTENT, PAGE HTML, VERIFIED BRAND FACTS, or the SITE BRIEF.`,
      `- The SITE BRIEF is verified client context: prefer its locations, approved CTAs / phone numbers, and spelling convention when filling LocalBusiness/Organization fields (telephone, areaServed, address) and respect its compliance notes. Do NOT contradict the brief.`,
      `- Treat PAGE HTML attributes as authoritative field values: itemprop/itemtype microdata, tel: links (telephone), mailto: (email), <time datetime> (dates), <address> (postal address), og:/meta (title, description, author). Prefer these over guessing.`,
      `- NEVER invent telephone, address, prices, opening hours, or geo data not present in the page, brand facts, or brief.`,
      `- NEVER output aggregateRating / review / ratingValue unless the count and value appear in the page content.`,
      `- NEVER mention anything in the neverSay list.`,
      `- Prefer types relevant to the page (FAQPage when an on-page FAQ exists, Service/Product for offerings, LocalBusiness/Organization for the brand, BreadcrumbList, Article for posts).`,
      `- Every jsonld must use "@context": "https://schema.org".`,
      ``,
      `DEDUP RULE (critical): the CMS-MANAGED SCHEMAS are the authority on what already exists —`,
      `NOT the detected live list. Before proposing anything, check the managed set by @type.`,
      `- Do NOT propose "add" for a @type that already exists in the CMS-MANAGED SCHEMAS (even if that`,
      `  managed row is "modified"/not yet live). That would create a duplicate.`,
      `- If a managed schema of that @type is ALREADY complete and correct, propose NOTHING for it.`,
      `- Only propose a change to an existing managed schema when you can CONCRETELY improve it — add`,
      `  missing fields/items, complete truncated values, or correct wrong data. Use kind "fix" (or`,
      `  "drift" if its data contradicts the page) and reference it with "targetManagedId": "<managedId>".`,
      `  Supply the FULL corrected jsonld (the complete schema, not just the delta).`,
      ``,
      `Three kinds of proposals:`,
      `1. "add": a NEW schema whose @type is NOT already in the CMS-MANAGED SCHEMAS.`,
      `2. "fix": a concretely improved/corrected version of an EXISTING schema. Reference a managed row`,
      `   with targetManagedId (preferred), or a detected-only block with targetScriptIndex+targetNodeIndex.`,
      `3. "drift": an EXISTING schema whose data contradicts the page content — corrected jsonld + explain`,
      `   the contradiction (reference with targetManagedId or targetScriptIndex+targetNodeIndex).`,
      ``,
      `RATIONALE (important): the CMS computes the exact structural diff (which fields/items were`,
      `added/removed/changed) deterministically and shows it to the user itself — do NOT enumerate or`,
      `count what changed in "rationale" (e.g. avoid "adds 4 Q&A pairs"). Instead use "rationale" to`,
      `explain WHY the change is warranted: the SEO/structured-data justification and the page grounding`,
      `(e.g. "The FAQ section on the page is not fully represented in the schema; completing it improves`,
      `eligibility for FAQ rich results."). Keep it to the reasoning, not the bookkeeping.`,
      ``,
      `Respond with STRICT JSON in exactly this shape:`,
      `{`,
      `  "proposals": [`,
      `    {`,
      `      "kind": "add" | "fix" | "drift",`,
      `      "type": "FAQPage",`,
      `      "jsonld": { "@context": "https://schema.org", "@type": "FAQPage", ... },`,
      `      "rationale": "WHY this change is warranted (SEO/grounding reasoning) — not a count of what changed.",`,
      `      "evidence": ["short quote or fact from the page that backs each key field"],`,
      `      "targetManagedId": null,`,
      `      "targetScriptIndex": null,`,
      `      "targetNodeIndex": null`,
      `    }`,
      `  ]`,
      `}`,
      `If every needed schema already exists in the CMS-MANAGED SCHEMAS and is complete/correct, return {"proposals": []}.`,
    ].join('\n');
  }
}
