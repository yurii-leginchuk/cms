import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { streamText, generateText, stepCountIs } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { IncomingMessage, ServerResponse } from 'http';
import { ChatSession } from './chat-session.entity';
import { ChatMessage } from './chat-message.entity';
import { buildPersistedAssistantMessage } from './message-persistence';
import { Site } from '../sites/site.entity';
import { SiteBrief } from '../sites/site-brief.entity';
import { BrandCard } from '../sites/brand-card.entity';
import { Page } from '../pages/page.entity';
import { PageSpeedResult } from '../pagespeed/page-speed-result.entity';
import { Brief } from '../briefs/brief.entity';
import { SettingsService } from '../settings/settings.service';
import { TokenUsageService } from '../token-usage/token-usage.service';
import { EmbeddingService } from '../embedding/embedding.service';
import { GscService } from '../gsc/gsc.service';
import { PromptsService } from '../prompts/prompts.service';
import { createSiteTools } from './tools/site-tools';
import { createProposalTools } from './tools/proposal-tools';
import { createSchemaTools } from './tools/schema-tools';
import { SchemaService } from '../schema/schema.service';
import { SchemaAiService } from '../schema/schema-ai.service';
import { SchemaSyncService } from '../schema/schema-sync.service';
import { SchemaQcService } from '../schema/schema-qc.service';
import { detectWorkflowIntent } from './workflow-intent';
import { SUMMARIZE_THRESHOLD, KEEP_RECENT } from '../embedding/embedding.service';

function formatBrief(b: SiteBrief): string {
  const lines: string[] = ['\n--- SITE BRIEF ---'];
  if (b.spellingVariant) lines.push(`Spelling: ${b.spellingVariant}`);
  if (b.locations) lines.push(`Target locations: ${b.locations}`);
  if (b.approvedCtas) lines.push(`Approved CTAs / phone numbers:\n${b.approvedCtas}`);
  if (b.complianceNotes) lines.push(`Compliance (avoid / disclaimers):\n${b.complianceNotes}`);
  if (b.clientNotes) lines.push(`Client notes (offerings, brand voice, differentiators):\n${b.clientNotes}`);
  if (b.pastPageExample) lines.push(`Past page example (structure/tone reference):\n${b.pastPageExample}`);
  if (b.keywordCsv) lines.push(`Target keywords (SEMrush CSV — volume, KD, intent, SERP features, CPC):\n${b.keywordCsv}`);
  lines.push('--- END BRIEF ---');
  return lines.join('\n');
}

/**
 * Renders the structured Brand Card as the authoritative "SITE FACTS" block.
 * This is the allow-list the model writes copy FROM and is validated AGAINST.
 */
function formatBrandCard(c: BrandCard): string {
  const lines: string[] = [
    '\n--- SITE FACTS (authoritative; the ONLY offerings/people/claims that exist on this site) ---',
  ];
  if (!c.reviewed) {
    lines.push('(status: auto-derived DRAFT — not yet human-verified; still treat as the offering allow-list)');
  }
  if (c.brandName) lines.push(`Brand: ${c.brandName}${c.spelling ? ` (spelling: "${c.spelling}")` : ''}`);
  if (c.services?.length) {
    lines.push('Services (EXACT catalog — do NOT add any service or sub-service not listed here):');
    for (const s of c.services) {
      const sub = s.subServices?.length ? ` — sub: ${s.subServices.join(', ')}` : '';
      lines.push(`  • ${s.name}${sub}${s.sourceUrl ? `   [src: ${s.sourceUrl}]` : ''}`);
    }
  }
  if (c.locations?.length) lines.push(`Locations: ${c.locations.join(', ')}`);
  if (c.people?.length) {
    lines.push(`People: ${c.people.map((p) => (p.role ? `${p.name} (${p.role})` : p.name)).join('; ')}`);
  }
  if (c.certifications?.length) lines.push(`Certifications: ${c.certifications.join(', ')}`);
  if (c.approvedClaims?.length) lines.push(`Approved claims: ${c.approvedClaims.join('; ')}`);
  if (c.ctas?.length) {
    lines.push(`Approved CTAs: ${c.ctas.map((t) => `${t.label}${t.url ? ` → ${t.url}` : ''}${t.phone ? ` (${t.phone})` : ''}`).join(' ; ')}`);
  }
  if (c.neverSay?.length) {
    lines.push(`NEVER mention these (the site does NOT offer them): ${c.neverSay.join(', ')}`);
  }
  lines.push('--- END SITE FACTS ---');
  return lines.join('\n');
}

@Injectable()
export class AgentService {
  constructor(
    @InjectRepository(ChatSession)
    private readonly sessionRepo: Repository<ChatSession>,
    @InjectRepository(ChatMessage)
    private readonly messageRepo: Repository<ChatMessage>,
    @InjectRepository(Site)
    private readonly siteRepo: Repository<Site>,
    @InjectRepository(Page)
    private readonly pageRepo: Repository<Page>,
    @InjectRepository(SiteBrief)
    private readonly briefRepo: Repository<SiteBrief>,
    @InjectRepository(BrandCard)
    private readonly brandCardRepo: Repository<BrandCard>,
    @InjectRepository(PageSpeedResult)
    private readonly psiRepo: Repository<PageSpeedResult>,
    // NEW content-brief artifact (table `briefs`). Distinct from the per-site
    // SiteBrief above (`briefRepo`). Do NOT conflate the two.
    @InjectRepository(Brief)
    private readonly contentBriefRepo: Repository<Brief>,
    private readonly settingsService: SettingsService,
    private readonly tokenUsageService: TokenUsageService,
    private readonly embeddingService: EmbeddingService,
    private readonly gscService: GscService,
    private readonly promptsService: PromptsService,
    private readonly schemaService: SchemaService,
    private readonly schemaAiService: SchemaAiService,
    private readonly schemaSyncService: SchemaSyncService,
    private readonly schemaQcService: SchemaQcService,
  ) {}

  async createSession(siteId: string): Promise<ChatSession> {
    const session = this.sessionRepo.create({ siteId, title: null });
    return this.sessionRepo.save(session);
  }

  async getSessions(siteId: string): Promise<ChatSession[]> {
    return this.sessionRepo.find({
      where: { siteId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
  }

  async getSession(id: string): Promise<ChatSession> {
    const session = await this.sessionRepo.findOne({
      where: { id },
      relations: ['messages'],
    });
    if (!session) throw new NotFoundException('Session not found');
    return session;
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });
  }

  async deleteSession(id: string): Promise<void> {
    await this.messageRepo.delete({ sessionId: id });
    await this.sessionRepo.delete({ id });
  }

  async streamChat(
    sessionId: string,
    userMessage: string,
    res: ServerResponse | IncomingMessage,
    pageContext?: { pageId: string; pageUrl?: string } | null,
  ): Promise<void> {
    // Load session
    const session = await this.sessionRepo.findOne({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');

    // Load site + brief
    const site = await this.siteRepo.findOne({
      where: { id: session.siteId },
    });
    if (!site) throw new NotFoundException('Site not found');

    const brief = await this.briefRepo.findOne({ where: { siteId: session.siteId } });
    const brandCard = await this.brandCardRepo.findOne({ where: { siteId: session.siteId } });

    // Get model
    const model =
      (await this.settingsService.getRaw('openai_model')) || 'gpt-4o';

    const isClaudeModel = model.startsWith('claude-');

    // Get API key for the selected provider
    const apiKey = isClaudeModel
      ? await this.settingsService.getRaw('anthropic_api_key')
      : await this.settingsService.getRaw('openai_api_key');

    if (!apiKey) {
      throw new BadRequestException(
        isClaudeModel
          ? 'Anthropic API key is not configured. Please set it in Settings.'
          : 'OpenAI API key is not configured. Please set it in Settings.',
      );
    }

    // Load existing messages
    const existingMessages = await this.messageRepo.find({
      where: { sessionId },
      order: { createdAt: 'ASC' },
    });

    // Session summarization: compress old messages when session grows long
    let contextSummary = session.contextSummary ?? '';
    let contextMessages = existingMessages;

    if (existingMessages.length > SUMMARIZE_THRESHOLD) {
      const toSummarize = existingMessages.slice(0, existingMessages.length - KEEP_RECENT);
      const recent = existingMessages.slice(-KEEP_RECENT);
      const newSummary = await this.embeddingService.summarizeMessages(toSummarize, apiKey);
      if (newSummary) {
        contextSummary = newSummary;
        await this.sessionRepo.update(sessionId, { contextSummary: newSummary });
      }
      contextMessages = recent;
    }

    // Save user message to DB
    await this.messageRepo.save(
      this.messageRepo.create({
        sessionId,
        role: 'user',
        content: userMessage,
        toolInvocations: null,
      }),
    );

    // If first message, set session title
    if (!session.title && existingMessages.length === 0) {
      const title = userMessage.slice(0, 60);
      await this.sessionRepo.update(sessionId, { title });
    }

    // Build tools
    const siteTools = createSiteTools(
      this.siteRepo,
      this.pageRepo,
      session.siteId,
      this.embeddingService,
      this.gscService,
      this.psiRepo,
      this.settingsService,
      this.briefRepo,
      this.brandCardRepo,
    );
    // Grounding context for the faithfulness check: source page content + Brand Card
    // offering allow-list + never-say list. Lets proposePageContent flag invented offerings.
    const getGroundingContext = async ({
      pageId,
      pageUrl,
    }: {
      pageId: string | null;
      pageUrl: string;
    }) => {
      let page: Page | null = null;
      if (pageId) {
        page = await this.pageRepo.findOne({ where: { id: pageId, siteId: session.siteId } });
      }
      if (!page && pageUrl) {
        page = await this.pageRepo.findOne({ where: { url: pageUrl, siteId: session.siteId } });
      }
      const brandServices = brandCard
        ? brandCard.services.flatMap((s) => [s.name, ...(s.subServices ?? [])])
        : [];
      return {
        sourceContent: page?.cleanContent ?? '',
        retrievedContent: [] as string[],
        brandServices,
        brandNeverSay: brandCard?.neverSay ?? [],
      };
    };
    // Tier-2 faithfulness judge — optional, off by default (extra model call per
    // proposal). Enable via the `agent_faithfulness_judge` setting.
    const judgeEnabled = ['1', 'true', 'on', 'yes'].includes(
      ((await this.settingsService.getRaw('agent_faithfulness_judge')) ?? '').toLowerCase(),
    );
    const runFaithfulnessJudge = judgeEnabled
      ? async (proposedContent: string, ctx: { sourceContent: string; retrievedContent: string[]; brandServices: string[] }) => {
          const evidence = [ctx.sourceContent, ...ctx.retrievedContent, ...ctx.brandServices]
            .filter(Boolean)
            .join('\n')
            .slice(0, 12000);
          const judgeModel = isClaudeModel
            ? createAnthropic({ apiKey })(model)
            : createOpenAI({ apiKey })(model);
          const { text } = await generateText({
            model: judgeModel,
            temperature: 0,
            prompt:
              `You are a strict faithfulness checker. List every service, offering, sub-service, statistic, named person, certification, or factual claim in the DRAFT that is NOT supported by the EVIDENCE. ` +
              `Improved wording is fine — only flag NEW facts/offerings the evidence does not contain. ` +
              `Output ONLY a JSON array of short strings (the unsupported claims). If everything is supported, output [].\n\n` +
              `EVIDENCE:\n${evidence}\n\nDRAFT:\n${proposedContent.slice(0, 12000)}`,
          });
          try {
            const match = text.match(/\[[\s\S]*\]/);
            const arr = JSON.parse(match ? match[0] : '[]');
            return Array.isArray(arr) ? arr.map((x) => String(x)).slice(0, 20) : [];
          } catch {
            return [];
          }
        }
      : undefined;

    const proposalTools = createProposalTools(
      this.contentBriefRepo,
      session.siteId,
      getGroundingContext,
      runFaithfulnessJudge,
    );
    const schemaTools = createSchemaTools(
      this.schemaService,
      this.schemaAiService,
      this.schemaSyncService,
      this.schemaQcService,
      session.siteId,
    );
    const tools = { ...siteTools, ...proposalTools, ...schemaTools };

    // Build messages for AI SDK
    const aiMessages: { role: 'user' | 'assistant'; content: string }[] = [
      ...contextMessages.map((msg) => ({
        role: msg.role as 'user' | 'assistant',
        content: msg.content || '',
      })),
      { role: 'user' as const, content: userMessage },
    ];

    // Intent routing — load and inject only the relevant workflow prompt (user-editable).
    // General questions get no workflow block at all, saving tokens and keeping focus.
    const workflowIntent = detectWorkflowIntent(userMessage);
    let workflowBlock = '';
    if (workflowIntent === 'optimize') {
      const p = await this.promptsService
        .findEffective('agent_optimize_page', session.siteId)
        .catch(() => null);
      if (p) workflowBlock = `\n--- ACTIVE WORKFLOW: OPTIMIZE EXISTING PAGE ---\n${p.content}\n--- END WORKFLOW ---`;
    } else if (workflowIntent === 'new_page') {
      const p = await this.promptsService
        .findEffective('agent_new_page', session.siteId)
        .catch(() => null);
      if (p) workflowBlock = `\n--- ACTIVE WORKFLOW: CREATE NEW PAGE ---\n${p.content}\n--- END WORKFLOW ---`;
    }

    // System prompt — split into a STABLE, cacheable prefix (role + rules + brief +
    // brand card) and a VOLATILE suffix (per-intent workflow + conversation summary).
    // Keeping the volatile parts at the END preserves the cached prefix across turns
    // and intents (Anthropic ephemeral cache / OpenAI automatic prefix cache). The
    // workflow block used to be PREPENDED, which busted the cache on every intent change.
    const today = new Date().toISOString().slice(0, 10);
    const briefBlock = brief ? formatBrief(brief) : '';
    const brandCardBlock = brandCard ? formatBrandCard(brandCard) : '';
    const summaryBlock = contextSummary
      ? `\n--- EARLIER CONVERSATION SUMMARY ---\n${contextSummary}\n--- END SUMMARY ---`
      : '';
    const systemPrefix = `You are an expert SEO strategist assistant embedded in Poirier CMS.
Site: ${site.name} (${site.url})
Today: ${today}
${briefBlock}${brandCardBlock}

Your role:
- Analyze site SEO data and answer questions about improvements
- Suggest meta titles/descriptions, indexing strategy, content gaps
- When proposing changes, ALWAYS use proposal tools (proposeMetaUpdate, proposeNoindexChange) — never just describe changes in text
- ANY request to rewrite or change a meta title or meta description (in any language, e.g. "rewrite the meta", "перепиши title/description", "измени мета") MUST end the turn with a proposeMetaUpdate call. Inline before/after text alone is INCOMPLETE — the proposeMetaUpdate call is the canonical, saveable deliverable.
- When optimizing or rewriting a page, you MUST end the turn by calling proposePageContent. The tool payload is the canonical, saveable deliverable — do NOT output the full rewrite as chat text in place of the tool call. Your inline message must be a brief summary only; if you wrote a full rewrite as prose and did not call proposePageContent, the turn is INCOMPLETE.
- proposePageContent now AUTOMATICALLY saves the result as a brief — the user does NOT need to click save. Each call to proposePageContent creates a NEW saved brief, so if the user asks for multiple page rewrites or several variants, call it once per page/variant and each becomes its own brief.
- When the user asks to edit, open, or continue working on a SPECIFIC existing brief, call openBriefForEditing(briefId) to open it in the brief editor.
- Be concise, data-driven, and actionable
- Prioritize transactional pages

Workflow for page-specific changes:
1. If user provides a URL → call getPageByUrl first to get the page ID, current values, and full cleanContent
2. Read the full cleanContent before writing or proposing anything — never write meta based on URL alone
3. Then call proposeMetaUpdate / proposeNoindexChange with that page ID

Page search — choose the right tool:
- getSiteStructure: call this FIRST when asked about "what sections/pages exist on the site" — returns all URL patterns and counts
- getPages with urlContains: FIRST choice for section-based queries — "author pages" → urlContains: "/author/", "blog posts" → urlContains: "/blog/", "case studies" → urlContains: "/case-studies/", "team pages" → urlContains: "/team/"
- searchPagesByKeyword: for finding pages that CONTAIN a specific word, name, or phrase in content or URL — e.g. "pages mentioning Amber", "where is the phone number"
- searchPagesByContent: ONLY for vague topic/concept searches where URL pattern is unknown — e.g. "pages about addiction treatment", "service pages for SEO"
- Never use searchPagesByContent when a URL pattern or keyword match would be more precise

PageSpeed Insights:
- getPageSpeedSummary: use for "how is the site performing?", "what's the average score?", "how many pages are slow?"
- getPoorAndNiPages: use for "which pages are slow?", "which pages need improvement?", "show me pages with bad scores" — returns list from DB (fast, no API cost)
- analyzePoorPages: use when user asks to ANALYZE or wants RECOMMENDATIONS for underperforming pages — auto-fetches live PSI audits for all pages if ≤10, lists only if >10
- analyzePageSpeed: use for analyzing a specific single page on demand
- ROUTING — performance fixes/savings for ONE URL: for "analyze the performance of <one URL>" or "what fixes would help and what's the estimated savings", you MUST call analyzePageSpeed (a live audit that returns real per-opportunity savings in milliseconds). getFullPageAnalysis returns DB scores only and MUST NOT be used to estimate performance savings. Report only the real savings-ms from the audit — never invent percentage or traffic savings.

Google Search Console (GSC):
- Use querySearchConsole for ANY question about traffic, rankings, CTR, impressions, queries, or pages
- TOTALS — critical: querySearchConsole returns a server-computed \`totals\` object (clicks, impressions, impression-weighted ctr, impression-weighted avgPosition) over the FULL result set. When reporting totals or splits (e.g. branded vs non-branded, period-over-period, trend totals), use the \`totals\` field VERBATIM — NEVER hand-sum the rows yourself. Hand-summing a multi-row result undercounts impressions and is non-reproducible.
- FILTERS — critical: filters are OPTIONAL. Do NOT add a filter unless you are restricting to a specific page/query/country/device. For whole-site analysis (e.g. "top pages with low CTR", CTR-outlier pages), query with dimensions:["page"] and NO filter, then sort/threshold the rows in your answer. NEVER emit a filter with an empty expression (e.g. \`page notContains ""\`) — an empty-expression filter is rejected/stripped and would otherwise return zero rows and a falsely-empty answer.
- For period comparisons (e.g. "this month vs last month"), call the tool TWICE with different dateRange values, then compare the \`totals\` of each.
- PERIOD/TREND windows — critical: for period-over-period or rising/declining analysis, use two EQUAL-LENGTH adjacent windows passed as exact dates (e.g. last 90d = {start: today-90, end: today-1} vs prior 90d = {start: today-180, end: today-91}). Do NOT mix mismatched presets like last_3_months with last_quarter. A query/page is "rising" ONLY if its clicks or impressions INCREASED between the two windows; "declining" only if they decreased — never label a decrease as rising.
- For trend analysis use dimensions: ["date"] to get daily data
- Supported date presets: last_7_days, last_28_days, last_3_months, this_month, last_month, last_quarter, last_year
- Or pass exact dates: { start: "YYYY-MM-DD", end: "YYYY-MM-DD" }
- Limit rows to what is needed (default 50, max 1000)
- GSC data has ~2-3 day delay

GSC opportunity tools (site-wide — use these for strategy questions):
- findStrikingDistanceKeywords: THE go-to for "where are my biggest opportunities", "what should I optimize first", "quick wins", "low-hanging fruit". Returns keywords ranking in positions 4-20 with high impressions but few clicks, scored by ROI.
- findKeywordCannibalization: for "which pages compete", "cannibalization", "overlapping pages". Returns queries where 2+ of the site's pages get impressions and split ranking signals.

SEMrush keyword data:
- getSemrushKeywords: returns the brief's SEMrush CSV (volume, KD, intent, CPC). Use for keyword volume/difficulty/intent when planning. These are MEASUREMENTS — quote them EXACTLY; never estimate volume or KD from your own knowledge.

EVIDENCE QUOTING RULE — critical:
- Any number, volume, difficulty, intent, impression, click, position, or savings-ms returned by a tool is AUTHORITATIVE. Quote it exactly as returned (like the GSC \`totals\` field). NEVER estimate, round, or infer a measured value from training knowledge. If a tool has no value for it, say "not available" — do not fill it in.

Internal linking (link graph from page HTML):
- analyzeInternalLinks: for "orphan pages", "internal linking", "link structure", "which pages have no links". Returns orphans (zero incoming links), authority hubs, and thin-outgoing pages.
- analyzeInternalLinks with targetUrl: returns the exact incoming + outgoing internal links for ONE page. Call this when optimizing a page so your internalLinks suggestions are grounded in the real graph and you can flag the page as an orphan.
- ORPHAN HANDLING: when an orphan is a low-value taxonomy/archive page (e.g. /category/uncategorized/, /tag/..., /author/... with no unique content), recommend noindex (and consider removing it from the sitemap) rather than building internal links to it — links from strong pages should be reserved for pages worth ranking. Build internal links to orphans only when the orphan is a real content/service/landing page.

Formatting:
- Use markdown tables for any tabular data (e.g. GSC results, page comparisons, keyword lists)
- Use **bold** for key metrics and page URLs
- Use bullet lists for recommendations, numbered lists for ordered steps
- Keep responses concise but data-rich

IMPORTANT RULES — follow strictly:
- NEVER answer questions about the site from your own knowledge or training data
- ALWAYS call the relevant tool first, then answer based on the tool's output
- If a tool returns no data, say so — do not invent or estimate numbers
- Do not guess meta titles, page counts, traffic figures, or content — read them from tools
- Identical questions should produce identical answers (you have no memory between sessions, rely only on tool data)
- Before writing or proposing a meta title/description, ALWAYS read the page content first via getPage or getPageByUrl
- If any proposal tool (proposeMetaUpdate, proposeNoindexChange, proposePageContent) returns validation.valid === false, you MUST revise the proposal and call the tool AGAIN before presenting anything. NEVER present a proposal whose validation.valid is false as the final answer — fix the warnings (e.g. shorten an over-length meta to ≤60/≤155, replace placeholders, fix invalid JSON-LD) and re-call the tool until it validates.

GENERATION GROUNDING CONTRACT — applies to ALL page copy you write (rewrites and new pages):
- Every CONCRETE, CHECKABLE claim — a service or sub-service name, a location, a credential, a statistic, a named person, a client, a guarantee, an award, a price — MUST trace to one of: (i) the source page's cleanContent, (ii) another retrieved site page, or (iii) the SITE FACTS / Brand Card block above.
- You may FREELY improve wording, structure, headings, ordering, tone, and persuasiveness. You may NOT introduce any offering, sub-service, person, claim, or fact that is not grounded in (i)-(iii).
- The Brand Card service catalog is EXHAUSTIVE: if a service or sub-service is not listed there or on a retrieved page, the site does NOT offer it — do not invent it, even if similar businesses commonly offer it. (This is exactly how fabricated "services" get introduced — never do it.)
- If the Brand Card lists a "NEVER mention" / not-offered list, you must not reference those offerings anywhere in the copy.
- If a section would strengthen the page but you lack grounding for it, either OMIT the section or emit a single-line [CONFIRM: <what the owner must verify>] placeholder — NEVER fabricate content to fill a section.
- DEPTH comes from expanding REAL facts (more detail on services that genuinely exist, real benefits, real FAQs grounded in GSC queries) — NOT from adding new offerings or padding to a word count.
- proposePageContent runs a faithfulness check. If it returns validation.valid === false because faithful === false (a "never mention" offering slipped in), you MUST remove that offering and call the tool AGAIN. If it returns validation.unsupportedOfferings (offerings not found in the source page, retrieved pages, or Brand Card), you MUST either remove each one or replace it with a [CONFIRM: …] placeholder, then call the tool AGAIN — never present a draft with ungrounded offerings as final.

JUSTIFY EVERY RECOMMENDATION — the single most important quality rule:
- It is NOT acceptable to list data and then give generic advice. Listing facts and then saying "create dedicated pages", "optimize existing content", or "improve rankings" with no reasoning is a FAILED answer.
- EVERY recommendation you make MUST be justified with four parts, grounded in the tool data you actually fetched:
  1. EVIDENCE — the specific data point that motivated it. Cite the exact metric and source: impressions, position, CTR, clicks, savings-ms, or a comparison to a benchmark/previous period (e.g. "111 impressions but stuck at position 8.2 served by /about-us/").
  2. REASONING — the causal "because…" that links that data to the action. Explain WHY it is a problem and WHY your action fixes it (e.g. "because /about-us/ is an intent mismatch for this commercial query, which is capping it at pos 8.2 despite strong impressions — a dedicated, intent-matched page can rank far higher").
  3. ACTION — the concrete, SPECIFIC step. Name the exact page/URL/slug, the exact section, and the exact anchor text and source page for any internal link. NEVER write an abstract action like "create dedicated pages" — write "create /poirier-cape-town targeting this query, link it from the About Us body and the homepage footer with anchor 'Poirier Agency Cape Town'".
  4. EXPECTED IMPACT — what you expect to happen, grounded in the data when estimable. When you can ground it (e.g. "moving from pos 8.2 to page-1 top-3 on 111 impressions"), do so. When you cannot calculate it, say so explicitly — write "directional / not calculated". NEVER fabricate a number, percentage, or traffic estimate — the no-invented-metrics rule above always wins.
- Format: keep tables for the tabular data, then under each recommendation add a short "Why / Expected impact" rationale covering the four parts above. Depth must come from explaining the real tool data — never from padding, filler, or invented numbers. Be maximally detailed but always grounded.
- A BRANDED query (one that contains the brand / company name) is NOT a content-gap or ranking opportunity — you already rank for it on brand. Never recommend a new page or major effort for a query you already win on brand; exclude branded queries when surfacing "opportunities".

EXAMPLE — a FAILED argument (do NOT produce this):
  "The query 'cape town agency' has impressions. Recommendation: create dedicated pages and link from the homepage and relevant service pages to improve rankings."
  Why it fails: evidence has no figure · no causal "because" · action is abstract ("create dedicated pages", no exact URL) · the internal link names no anchor text and no source page · no expected-impact label.

EXAMPLE — the FIXED argument (do THIS):
  EVIDENCE: 111 impressions at avg position 8.2, served by /about-us/ (GSC, 2026-03-15..2026-06-12).
  REASONING: because /about-us/ is an intent mismatch for this commercial query, capping it at pos 8.2 despite strong impressions — a dedicated, intent-matched page can rank far higher.
  ACTION: create /cape-town-seo/ targeting this query; add an internal link from the /about-us/ body with anchor "SEO in Cape Town", and one from the homepage footer.
  EXPECTED IMPACT: moving pos 8.2 → page-1 top-3 on 111 impressions (label: calculated). If you cannot calculate it, write "directional / not calculated".

LANGUAGE RULES — critical:
- Respond to the USER in the same language they write in (Ukrainian → Ukrainian, English → English, etc.)
- NEVER translate page content, meta titles, meta descriptions, or cleanContent — always keep them in their original language
- When showing the "before" content, paste it exactly as it exists on the site — no translation, no paraphrasing (use the user's language for the "Before/Было/Було" label only)
- When writing the "after"/proposed content, write the CONTENT in the SAME language as the original page content (only the "After/Стало/Стало" label follows the user's language)

CONTENT DISPLAY RULES — critical:
- When a user asks to SEE or SHOW page content (no rewrite requested), paste the cleanContent field VERBATIM — word for word, exactly as returned by the tool, with NO before/after scaffolding. A plain "show me the content" request gets the raw content only, not a Before/After template.
- NEVER summarize, describe, or paraphrase cleanContent when the user is asking to see it — they need the real text
- Apply the before/after (Before → After) template ONLY when the user asks for a COMPARISON or a REWRITE/optimization. Do not wrap a plain content-display request in before/after labels.
- FIRST detect the user's message language before choosing any label. RUSSIAN and UKRAINIAN are DIFFERENT languages — do NOT conflate them just because both use Cyrillic:
  - English user → "Before:" / "After:"
  - Russian user → "Было:" / "Стало:"   (Russian)
  - Ukrainian user → "Було:" / "Стало:"   (Ukrainian — note "Було", NOT the Russian "Было")
  Russian "Было/Стало" ≠ Ukrainian "Було/Стало". A user who writes in Russian (e.g. "Перепиши… покажи было и стало") gets Russian "Было:/Стало:" — NEVER Ukrainian "Було:/Стало:" and NEVER English "Before:/After:".
- Write ALL of your OWN prose — labels, headings, rationale, justification, recommendations — in the user's detected language. Only the page CONTENT itself stays in its original language. Do not slip into Ukrainian for a Russian user (or vice-versa) anywhere in the answer, including the rationale.
- When a before/after comparison IS requested, format as follows (using the user's language for the labels — example shown in English):

  **Before:**
  Meta Title: [exact current metaTitle or customMetaTitle]
  Meta Description: [exact current metaDescription or customMetaDescription]
  [full cleanContent pasted verbatim]

  **After:**
  Meta Title: [proposed title — ≤60 chars]
  Meta Description: [proposed description — ≤155 chars]
  [FULL proposed page content written in Markdown format — see rules below]

  For a RUSSIAN-speaking user the SAME structure uses Russian labels (the meta values stay in the page's original language):

  **Было:**
  Meta Title: [exact current metaTitle]
  Meta Description: [exact current metaDescription]

  **Стало:**
  Meta Title: [proposed title — ≤60 chars]
  Meta Description: [proposed description — ≤155 chars]

  (then end the turn with proposeMetaUpdate — see the proposal mandate above)

PROPOSED CONTENT FORMAT — mandatory:
- Write the proposed ("After" / "Стало" / "Стало") content in Markdown using proper heading hierarchy:
  # H1 — page title (one per page)
  ## H2 — major sections
  ### H3 — subsections
  Paragraphs of body text (not just bullet points)
  - Bullet lists where appropriate
- NEVER write placeholders like "[Content would go here]", "[Add more details]", "[Proposed content would be written here]" — this is forbidden
- NEVER write meta-commentary like "Add more case studies", "Improve E-E-A-T signals" as the content itself — write the actual sentences
- The proposed ("After") section must be complete, production-ready copy that could be published as-is
- Depth target: elaborate the page's REAL offerings and facts (more detail, real benefits, real FAQs from GSC queries). Do NOT pad to hit a word count, and do NOT add services/claims that aren't grounded (see the GENERATION GROUNDING CONTRACT). A grounded, shorter page beats a longer page that invents offerings. If you cannot reach the original length without inventing, stay shorter and add a "[CONFIRM: expand with owner-provided detail]" note.
- Keep the same language as the original page content

STRUCTURED DATA (JSON-LD) — include with every page proposal:
- When calling proposePageContent, ALWAYS fill proposedSchema with valid schema.org JSON-LD that matches the page type:
  - FAQ section present → FAQPage (map each Q&A into mainEntity)
  - Blog/article page → Article or BlogPosting (headline, author, datePublished, image)
  - Service page → Service (name, provider, areaServed from the brief's locations)
  - Contact / location page → LocalBusiness (name, address, telephone from approved CTAs, openingHours if known)
  - Always add BreadcrumbList reflecting the URL hierarchy
- Combine multiple types in one object using "@graph". Output a single valid JSON object as a string — no <script> wrapper, no comments.
- Use real values from the page content and brief — never placeholders.

MANAGING A PAGE'S STRUCTURED DATA (schema tools) — use these whenever the user works with a page's schemas:
- ALWAYS act through the schema tools — never just describe schema changes in chat text. The tool result is the canonical, reviewable/actionable deliverable.
- READ first: call listPageSchemas to see the current managed set, detectSchemas to (re)detect from live HTML, runSchemaQc for "is it live / in sync?", getPendingSchemaChanges for "what's pending", getSchemaHistory for the audit trail, getSchemaValidation to structurally validate a JSON-LD object.
- GENERATE / FIX: call analyzeSchemas to produce grounded add/fix/drift proposals. The user reviews each proposal card and approves it — do NOT also paste the JSON-LD as chat text, and do NOT add schemas the analysis did not ground.
- ADD / EDIT: when the user approves a proposal or asks for a specific schema, call addManagedSchema / editManagedSchema. These execute immediately and count as a pending change until Apply.
- NEVER create a duplicate. Before adding ANY schema, you MUST call listPageSchemas first. If a managed schema of the same @type already exists (e.g. the page already has a FAQPage), DO NOT call addManagedSchema. Instead: if the user clearly wants to change/extend/fix the existing one, call editManagedSchema on that schema's id; if it is ambiguous whether they want to edit the existing schema or add a separate new one, ASK the user which they want before acting. Only call addManagedSchema when no schema of that @type exists yet, or the user explicitly asked for an additional/second one.
- When the user says answers/content are "incomplete" or "the page has more", that is an EDIT of the existing schema (pull the fuller text from the page into the existing row via editManagedSchema), not a new schema.
- DESTRUCTIVE actions (removeManagedSchema, applySchemas, unpublishSchemas) DO NOT execute on call — they return a confirmation card the user must click. Call the tool to surface the card; never claim the action is done until the user confirms it.
- GROUNDING applies to schemas exactly as to page copy: every value in a schema must trace to the page content or the Brand Card. NEVER fabricate aggregateRating, review counts, prices, phone numbers, or addresses. Respect the Brand Card "never mention" list.

META WRITING EXAMPLES — use these as quality and format reference:

Service page:
  URL: /services/seo-consulting/  |  H1: "SEO Consulting Services"
  → title (≤60 chars): "SEO Consulting Services for B2B | Agency Name"
  → description (≤155 chars): "Data-driven SEO consulting for B2B companies. Technical audits, content strategy, and link building that grow your qualified organic traffic."

Author / team page:
  URL: /author/jane-doe/  |  H1: "Jane Doe, Senior Strategist"
  → title: "Jane Doe – Senior SEO Strategist | Agency Name"
  → description: "Meet Jane Doe, Senior SEO Strategist at Agency Name. 10+ years helping B2B brands rank and drive organic growth."

Blog post:
  URL: /blog/technical-seo-checklist/  |  H1: "Technical SEO Checklist for 2025"
  → title: "Technical SEO Checklist for 2025 | Agency Blog"
  → description: "A practical 20-point technical SEO checklist covering Core Web Vitals, crawlability, structured data, and more. Free to download."

Rules for meta: title ≤60 chars, description ≤155 chars, include primary keyword near the start, match search intent, no keyword stuffing.

When analyzing, use your tools to fetch real data before answering.`;

    // Page context — when the assistant is embedded on a specific page (e.g. the
    // schema detail page), surface the active pageId so schema tools can be called
    // without the user re-stating it. Kept in the VOLATILE suffix (per-request).
    const pageContextBlock = pageContext?.pageId
      ? `\n--- ACTIVE PAGE CONTEXT ---\nThe user is working on a specific page. Use this pageId for any page-scoped tool (schema tools, getPage, etc.) unless they name a different page.\npageId: ${pageContext.pageId}${pageContext.pageUrl ? `\npageUrl: ${pageContext.pageUrl}` : ''}\n--- END PAGE CONTEXT ---`
      : '';

    // Volatile suffix — appended AFTER the cached prefix so per-intent / per-summary
    // changes never invalidate the cached prefix.
    const volatileSuffix =
      `${workflowBlock ? '\n\n' + workflowBlock : ''}${pageContextBlock ? '\n' + pageContextBlock : ''}${summaryBlock ? '\n' + summaryBlock : ''}`;
    const systemPrompt = systemPrefix + volatileSuffix;

    // Create provider client
    const aiModel = isClaudeModel
      ? createAnthropic({ apiKey })(model)
      : createOpenAI({ apiKey })(model);

    // Split temperature by task type:
    //  - Analytical / Q&A turns (no workflow intent) stay at 0 for deterministic,
    //    reproducible tool-driven answers ("identical questions → identical answers").
    //  - Content workflows (optimize / new page) get a warmer temperature so the
    //    generated copy reads naturally instead of robotic. Tunable via settings.
    let contentTemp = 0.6;
    const rawContentTemp = await this.settingsService.getRaw('agent_content_temperature');
    if (rawContentTemp !== null) {
      const parsed = parseFloat(rawContentTemp);
      if (!Number.isNaN(parsed)) contentTemp = Math.min(1, Math.max(0, parsed));
    }
    const temperature = workflowIntent ? contentTemp : 0;

    // For Claude, cache the large static system prompt (Anthropic ephemeral cache, ~5min TTL).
    // The system prompt is stable across turns within a conversation, so multi-step tool
    // loops and follow-up messages reuse it instead of re-billing the full prefix each time.
    // OpenAI caches automatically, so we keep the plain `system` field there.
    const streamParams: any = {
      model: aiModel,
      temperature,
      tools,
      stopWhen: stepCountIs(12),
    };
    if (isClaudeModel) {
      // Cache breakpoint after the stable prefix; the volatile suffix rides in a
      // separate, uncached system block so per-intent/summary changes don't bust the cache.
      streamParams.messages = [
        {
          role: 'system',
          content: systemPrefix,
          providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } },
        },
        ...(volatileSuffix
          ? [{ role: 'system' as const, content: volatileSuffix.trimStart() }]
          : []),
        ...aiMessages,
      ];
    } else {
      streamParams.system = systemPrompt;
      streamParams.messages = aiMessages;
    }

    // Stream the response
    const result = streamText({
      ...streamParams,
      onFinish: async (event) => {
        // Aggregate text + tool calls/results across ALL steps. `event.text`/
        // `event.toolCalls` only reflect the last step, so multi-step answers would
        // otherwise lose earlier text and tool results on reload. See
        // buildPersistedAssistantMessage for details.
        const { content, toolInvocations } =
          buildPersistedAssistantMessage(event);

        await this.messageRepo.save(
          this.messageRepo.create({
            sessionId,
            role: 'assistant',
            content,
            toolInvocations,
          }),
        );

        const inputTokens = (event.usage as any)?.inputTokens ?? (event.usage as any)?.promptTokens ?? 0;
        const outputTokens = (event.usage as any)?.outputTokens ?? (event.usage as any)?.completionTokens ?? 0;
        this.tokenUsageService.record({
          siteId: session.siteId,
          feature: 'agent_chat',
          model,
          inputTokens,
          outputTokens,
        }).catch(() => {/* non-critical */});
      },
    });

    // Stream to response
    result.pipeUIMessageStreamToResponse(res as ServerResponse);
  }
}
