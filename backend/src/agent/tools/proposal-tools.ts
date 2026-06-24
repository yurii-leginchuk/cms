import { tool, zodSchema } from 'ai';
import { z } from 'zod';
import { Repository } from 'typeorm';
import { Brief } from '../../briefs/brief.entity';
import {
  validateProposedContent,
  validateRecommendations,
  checkFaithfulness,
  GroundingContext,
  RecommendationInput,
} from './proposal-validation';

// Zod schema enforcing the structured recommendation argument (Proposal 9).
// Mirrors RecommendationInput in proposal-validation.ts.
const recommendationSchema = z.object({
  evidence: z.object({
    metric: z.string().describe('Exact metric WITH a number, quoted verbatim from a tool result, e.g. "111 impressions at avg position 8.2". No figure → rejected.'),
    source: z.enum(['gsc', 'psi', 'semrush', 'onpage', 'internal_links']).describe('Which tool/source produced this metric.'),
    dateRange: z.string().nullable().describe('Window the metric covers, e.g. "2026-03-15..2026-06-12". null for non-temporal sources.'),
  }),
  reasoning: z.string().describe('The causal link — MUST contain "because": why the data is a problem AND why the action fixes it.'),
  action: z.object({
    type: z.enum(['new_page', 'meta', 'internal_link', 'content', 'noindex']),
    targetUrl: z.string().describe('Exact URL/slug acted on, e.g. "/cape-town-seo/". Abstract text ("create dedicated pages") → rejected.'),
    anchorText: z.string().nullable().describe('Required when type==="internal_link": exact anchor text. null otherwise.'),
    sourcePage: z.string().nullable().describe('Required when type==="internal_link": exact page the link is placed ON. null otherwise.'),
  }),
  expectedImpact: z.object({
    estimate: z.string().nullable().describe('Grounded outcome, e.g. "pos 8.2 → top-3 on 111 impressions". null if not calculable.'),
    label: z.enum(['calculated', 'directional_not_calculated']).describe('Use "directional_not_calculated" whenever estimate is null or non-numeric.'),
  }),
});

/**
 * Builds grounding context for a content proposal (source page + Brand Card +
 * retrieved pages) so the faithfulness check can flag invented offerings.
 * Supplied by AgentService, which holds the repos.
 */
export type GetGroundingContext = (args: {
  pageId: string | null;
  pageUrl: string;
}) => Promise<GroundingContext>;

/**
 * Optional Tier-2 faithfulness judge: an LLM pass that lists claims in the draft
 * not supported by the grounding context. Returns a list of unsupported claim
 * strings (empty if all grounded). Gated by a setting in AgentService.
 */
export type RunFaithfulnessJudge = (
  proposedContent: string,
  ctx: GroundingContext,
) => Promise<string[]>;

export function createProposalTools(
  contentBriefRepo: Repository<Brief>,
  siteId: string,
  getGroundingContext?: GetGroundingContext,
  runFaithfulnessJudge?: RunFaithfulnessJudge,
) {
  return {
    proposePageContent: tool({
      description:
        'Save a full page content proposal (rewrite or new page). ' +
        'ALWAYS call this at the end of any optimization or new-page workflow to deliver structured output the user can review and copy. ' +
        'For new pages set pageId to null.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string().nullable().describe('Existing page ID, or null for a new page'),
          pageUrl: z.string().describe('Current URL or proposed URL for new pages'),
          proposedMetaTitle: z.string().describe('Proposed meta title ≤60 chars'),
          proposedMetaDescription: z.string().describe('Proposed meta description ≤155 chars'),
          proposedSlug: z.string().nullable().describe('Suggested URL slug — for new pages only, null for existing'),
          proposedContent: z.string().describe('Full proposed page content in Markdown with H1-H3 hierarchy'),
          proposedSchema: z.string().nullable().describe(
            'JSON-LD structured data (schema.org) as a STRING. Build the types that fit the page: ' +
            'FAQPage from the FAQ section, Article/BlogPosting for posts, Service for service pages, ' +
            'LocalBusiness for contact/location pages, BreadcrumbList for hierarchy. ' +
            'Combine multiple types with @graph. Must be a single valid JSON object (no <script> wrapper). null if none applies.'),
          keywordStrategy: z.string().describe('Primary keyword + 3-6 supporting terms with rationale'),
          internalLinks: z.array(z.object({
            anchor: z.string(),
            targetUrl: z.string(),
          })).describe('6-10 internal link suggestions'),
          recommendations: z.array(recommendationSchema).min(1).describe(
            'Priority recommendations — each a STRUCTURED argument (evidence/reasoning/action/expectedImpact). At least one.'),
          sectionSources: z.array(z.object({
            sectionHeading: z.string(),
            source: z.string().describe('source page URL or Brand Card field, e.g. "/services/seo/" or "brandCard.services"'),
          })).nullable().describe(
            'Provenance per major H2 section — cite where each section\'s facts come from. A section with no real source must be omitted or [CONFIRM]-tagged. null if not provided.'),
        }),
      ),
      execute: async (args: {
        pageId: string | null;
        pageUrl: string;
        proposedMetaTitle: string;
        proposedMetaDescription: string;
        proposedSlug: string | null;
        proposedContent: string;
        proposedSchema: string | null;
        keywordStrategy: string;
        internalLinks: { anchor: string; targetUrl: string }[];
        recommendations: RecommendationInput[];
        sectionSources?: { sectionHeading: string; source: string }[] | null;
      }) => {
        const contentValidation = validateProposedContent(args);
        const recValidation = validateRecommendations(args.recommendations);

        // Faithfulness: flag offerings/claims in the draft that aren't grounded.
        let faithfulness: ReturnType<typeof checkFaithfulness> | null = null;
        let judgeClaims: string[] = [];
        if (getGroundingContext) {
          try {
            const ctx = await getGroundingContext({ pageId: args.pageId, pageUrl: args.pageUrl });
            faithfulness = checkFaithfulness(args.proposedContent, ctx);
            // Tier-2: LLM-judge for paraphrased inventions Tier-1's string match misses.
            if (runFaithfulnessJudge) {
              try {
                judgeClaims = await runFaithfulnessJudge(args.proposedContent, ctx);
              } catch {
                judgeClaims = [];
              }
            }
          } catch {
            faithfulness = null; // grounding unavailable — don't block on it
          }
        }

        const unverifiedClaims = [
          ...(faithfulness ? [...faithfulness.forbiddenHits, ...faithfulness.unsupportedOfferings] : []),
          ...judgeClaims,
        ];

        const validation = {
          ...contentValidation,
          recommendationWarnings: recValidation.warnings,
          // A forbidden ("never mention") offering is a HARD fail → forces a re-call.
          // Merely-unsupported offerings are advisory (surfaced as unverifiedClaims).
          faithful: faithfulness ? faithfulness.faithful : null,
          unsupportedOfferings: faithfulness?.unsupportedOfferings ?? [],
          judgeUnsupportedClaims: judgeClaims,
          valid: contentValidation.valid && recValidation.valid && (faithfulness ? faithfulness.faithful : true),
        };

        // Still persist (so the user can review/fix), but tag the unverified claims
        // so the editor shows a "confirm or remove" banner instead of saving silently.
        const brief = await contentBriefRepo.save(
          contentBriefRepo.create({
            siteId,
            ...args,
            unverifiedClaims: unverifiedClaims.length ? unverifiedClaims : null,
            status: 'draft',
          }),
        );
        return {
          type: 'proposal',
          action: 'content_proposal',
          ...args,
          briefId: brief.id,
          validation,
          faithfulness,
        };
      },
    }),

    openBriefForEditing: tool({
      description:
        'Open an existing saved brief in the brief editor for the user to edit. ' +
        'Call this when the user asks to edit, open, or continue working on a specific brief.',
      inputSchema: zodSchema(
        z.object({
          briefId: z.string().describe('The id of the saved brief to open'),
        }),
      ),
      execute: async (args: { briefId: string }) => ({
        type: 'navigation',
        action: 'open_brief',
        briefId: args.briefId,
        siteId,
      }),
    }),

    proposeMetaUpdate: tool({
      description:
        'Propose updating meta title and/or description for a page. ALWAYS use this when suggesting meta changes instead of just describing them in text.',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string(),
          pageUrl: z.string(),
          currentTitle: z.string().nullable(),
          currentDescription: z.string().nullable(),
          proposedTitle: z
            .string()
            .nullable()
            .describe('New meta title, null if not changing'),
          proposedDescription: z
            .string()
            .nullable()
            .describe('New meta description, null if not changing'),
          reasoning: z
            .string()
            .describe('Brief explanation of why these changes improve SEO'),
        }),
      ),
      execute: async (args: {
        pageId: string;
        pageUrl: string;
        currentTitle: string | null;
        currentDescription: string | null;
        proposedTitle: string | null;
        proposedDescription: string | null;
        reasoning: string;
      }) => {
        const warnings: string[] = [];
        if (args.proposedTitle && args.proposedTitle.length > 60) warnings.push(`Proposed title is ${args.proposedTitle.length} chars (recommended ≤60).`);
        if (args.proposedDescription && args.proposedDescription.length > 155) warnings.push(`Proposed description is ${args.proposedDescription.length} chars (recommended ≤155).`);
        return {
          type: 'proposal',
          action: 'update_meta',
          ...args,
          validation: { valid: warnings.length === 0, warnings },
        };
      },
    }),

    proposeNoindexChange: tool({
      description: 'Propose changing the noindex status for a page',
      inputSchema: zodSchema(
        z.object({
          pageId: z.string(),
          pageUrl: z.string(),
          currentNoindex: z.boolean(),
          proposedNoindex: z.boolean(),
          reasoning: z.string(),
        }),
      ),
      execute: async (args: {
        pageId: string;
        pageUrl: string;
        currentNoindex: boolean;
        proposedNoindex: boolean;
        reasoning: string;
      }) => ({
        type: 'proposal',
        action: 'noindex_change',
        ...args,
      }),
    }),
  };
}
