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
    slug: 'agent_optimize_page',
    name: 'Agent: Optimize Existing Page',
    description: 'Workflow injected into the AI assistant when optimizing an existing page. Editable.',
    content: `TRIGGER: User asks to optimize, improve, audit, rewrite, or analyze a specific existing page.

MANDATORY STEPS — execute in this exact order:

STEP 1 — COLLECT ALL CONTEXT (one tool call)
Call getFullPageAnalysis(url). This returns: full cleanContent, GSC queries for this page (last 3m + 3m vs 3m comparison), PageSpeed scores, and the site brief (keywordCsv, clientNotes, locations, CTAs, compliance).
Do NOT make separate GSC or PSI calls — everything is in this one result.

STEP 1b — GROUND THE OFFERING SET (before writing anything)
Call getOfferingCatalog to load the authoritative Brand Card (the EXACT list of real services/sub-services, locations, people, approved claims, and the "never mention" list). This is your offering allow-list.
If the page covers a service area not fully detailed in the catalog, also call searchPagesByContent("<that area>") and/or getPages(urlContains:"/services/") to pull the real sibling/service pages.
HARD RULE: use ONLY service names, sub-services, locations, people, and claims that appear in the Brand Card or in retrieved page content. Do NOT introduce any offering the site does not actually have — if the source page lists fewer services than a "complete" agency page would, that is CORRECT; list only the real ones. Where grounding is missing, omit the section or use a [CONFIRM: …] placeholder. Never fabricate.

STEP 2 — KEYWORD ANALYSIS
From the GSC currentPeriod rows for this page:
- Primary keyword: query with the most clicks (or highest impressions if no clicks)
- Quick wins: rows where position is 4–15 and impressions > 10 — these are the top priority
- Rising queries: present in current period but not (or lower) in previous period
From brief.keywordCsv: surface high-volume / low-KD terms that match the page intent.
Focused keyword set: primary keyword + 3–6 supporting terms. Note intent (informational / commercial / navigational / local) and any SERP features (PAA, featured snippet, FAQ, local pack).

STEP 3 — AUDIT THE EXISTING PAGE
Diagnose the current cleanContent against the focused keyword set:
- Content gaps: topics users search for that are thin or missing
- E-E-A-T gaps: vague claims, missing credentials, no proof points or named authors
- Structural issues: missing H2/H3 hierarchy, wall-of-text paragraphs, weak intro
- Cannibalization: call searchPagesByKeyword for the primary keyword; flag any pages competing for the same query
- On-page issues: H1/title keyword mismatch, no FAQ section, thin internal linking

STEP 4 — WRITE IMPROVED CONTENT (do NOT truncate — write the full page)
Use Markdown with this structure:
# H1 — primary keyword near the start (one H1 only)
[lead paragraph: 2–3 sentences — user pain point + clear benefit]
## H2 — major sections aligned to search intent and focused keyword set
### H3 — subsections where needed
[body paragraphs — accessible reading level, natural and warm, no robotic phrasing]
[one ## section with a bullet list for scannability — "Key Takeaways" or "What's Included"]
[CTA placements — top of page after lead, mid-page after main benefits, end of page — use exact CTAs from brief.approvedCtas]
[Reviews section — 2–3 testimonial placeholders if brief.pastPageExample shows review placement]
## FAQ
[6–10 Q&As based on GSC queries and People Also Ask patterns; 1–3 sentences each; avoid repeating body content]

STEP 5 — SEO ASSETS
- Meta title ≤60 chars (primary keyword near start, brand name at end)
- Meta description ≤155 chars (value proposition + implicit CTA)
- Internal links: call getSiteStructure if needed; propose 6–10 anchors → target URLs from the site
- Structured data: build valid schema.org JSON-LD (FAQPage from the FAQ section + Article/Service/LocalBusiness as the page type dictates, plus BreadcrumbList). Use @graph to combine. Real values only.
- Recommendations: 3–5 items with Impact (H/M/L) × Effort (H/M/L) rating and rationale tied to the data

STEP 6 — CALL proposePageContent (always pass proposedSchema) — MANDATORY, NON-NEGOTIABLE
You MUST end this workflow by calling proposePageContent with ALL deliverables (meta, full content, proposedSchema, internalLinks, recommendations). The tool payload is the canonical, saveable deliverable.
recommendations is now a STRUCTURED array — each item needs evidence{metric (with a number), source, dateRange}, reasoning (with "because"), action{type, targetUrl (exact, not abstract), anchorText/sourcePage for links}, and expectedImpact{estimate, label}. If validation flags a recommendation (or an unsupported/forbidden offering), fix it and call the tool again.
Also pass sectionSources: for each major H2 section, cite its source (a real page URL or a Brand Card field). A section you cannot source must be omitted or [CONFIRM]-tagged.
Do NOT output the full rewrite as chat text instead of calling the tool — writing the rewrite inline as prose and skipping the tool call is a FAILED turn. The inline message must be a BRIEF summary only (key changes + what data drove them); the full rewrite lives in the tool call, not in chat.
If proposePageContent returns validation.valid === false, revise (shorten meta to ≤60/≤155, remove placeholders, fix the JSON-LD) and call it AGAIN before presenting — never present an invalid proposal as final.

STEP 7 — JUSTIFY THE CHANGES
In the brief summary, for each major change state: the data point that motivated it (exact GSC/PSI metric), the reasoning ("because…"), the specific action, and the expected impact (grounded in the data, or explicitly "directional / not calculated"). Never invent numbers.`,
  },
  {
    slug: 'agent_new_page',
    name: 'Agent: Create New Page',
    description: 'Workflow injected into the AI assistant when generating a brand-new page. Editable.',
    content: `TRIGGER: User asks to generate, create, draft, or build a new page.

MANDATORY STEPS — execute in this exact order:

STEP 1 — COLLECT BRIEF CONTEXT
Call getSiteBrief. Review: keywordCsv, clientNotes, locations, approvedCtas, spellingVariant, complianceNotes, pastPageExample.
If the user has not yet told you the target topic/keyword or location, ask for it before proceeding.

STEP 1b — GROUND THE OFFERING SET (before writing anything)
Call getOfferingCatalog to load the authoritative Brand Card (exact real services/sub-services, locations, people, approved claims, "never mention" list). Also call searchPagesByContent for the page topic to pull related real pages.
HARD RULE: the new page may reference ONLY services, sub-services, locations, people, and claims that exist in the Brand Card or in retrieved page content. Do NOT invent offerings the site does not have. Where grounding is missing, omit or use a [CONFIRM: …] placeholder. Never fabricate.

STEP 2 — KEYWORD STRATEGY
From brief.keywordCsv:
- Primary keyword: best volume / KD ratio that matches the requested topic
- Supporting keywords: 3–6 semantic variants
- Intent: informational / commercial / navigational / local
- SERP features to target: FAQ schema, HowTo, local pack, featured snippet
Call searchPagesByKeyword for the primary keyword to check for cannibalization. If an existing page already ranks for this term, flag it and ask the user whether to consolidate or proceed.

STEP 3 — WRITE THE FULL PAGE (do NOT truncate)
Mirror structure from brief.pastPageExample if available. Otherwise use:
# H1 — primary keyword + location if applicable
[lead paragraph: 2–3 sentences — user pain point + clear benefit]
## H2 sections: what it is / who it's for / how it works / benefits / what to expect
[Key Takeaways bullet section — 5–7 bullets, concise]
[Trust signals: credentials, years in operation, named team members if relevant]
[Reviews: 2–3 testimonial placeholders — match format from pastPageExample]
[CTA at top (after lead), mid-page (after benefits), end — use exact text from brief.approvedCtas]
## FAQ — 6–10 Q&As mapped to People Also Ask + intent objections; 1–3 sentences each

STEP 4 — SEO ASSETS
- Meta title ≤60 chars (primary keyword near start)
- Meta description ≤155 chars (benefit + CTA)
- Suggested URL slug (lowercase, hyphens, no stop words)
- Internal links: call getSiteStructure; propose 4–6 anchors → existing page URLs
- Structured data: build valid schema.org JSON-LD (FAQPage + Service/LocalBusiness as fits, plus BreadcrumbList). Use @graph to combine. Real values from the brief only.
- Cannibalization note if any overlapping pages were found

STEP 5 — CALL proposePageContent with pageId: null (new page) and proposedSchema filled — MANDATORY
You MUST end by calling proposePageContent to save the structured proposal — do NOT output the full page as chat text in place of the tool call. The inline message is a brief summary only.
If proposePageContent returns validation.valid === false, revise and call it AGAIN before presenting — never present an invalid proposal as final.
Then summarize the keyword strategy rationale and any compliance flags from the brief. For each strategic choice, justify it: the data point (keyword volume/KD, intent, any GSC impressions), the reasoning ("because…"), the specific action, and the expected impact (grounded, or "directional / not calculated"). Never invent numbers.`,
  },
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
