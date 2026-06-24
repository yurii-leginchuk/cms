// Pure validation for content proposals — kept standalone so it can be unit-tested
// and so the agent gets actionable warnings it can self-correct on.

const PLACEHOLDER_RE = /\[(proposed|content|add|insert|your|placeholder|write|todo|example)[^\]]*\]/i;

// ── Structured recommendation argument (Proposal 9) ──────────────────────────
// Each recommendation must carry a full evidence→reasoning→action→impact argument.
// The TS interface lives here (pure, no deps) so the Brief entity and the eval
// harness can share it; the Zod schema that enforces it lives in proposal-tools.ts.
export interface RecommendationInput {
  evidence: {
    metric: string; // exact figure quoted from a tool, e.g. "111 impressions at pos 8.2"
    source: 'gsc' | 'psi' | 'semrush' | 'onpage' | 'internal_links';
    dateRange: string | null;
  };
  reasoning: string; // causal "because…"
  action: {
    type: 'new_page' | 'meta' | 'internal_link' | 'content' | 'noindex';
    targetUrl: string; // exact URL/slug — not an abstract instruction
    anchorText: string | null;
    sourcePage: string | null;
  };
  expectedImpact: {
    estimate: string | null;
    label: 'calculated' | 'directional_not_calculated';
  };
}

// Render structured recommendations as readable plain text (for DOCX/HTML export
// and any legacy string consumer). Tolerates a legacy string value.
export function formatRecommendationsText(
  recs: RecommendationInput[] | string | null | undefined,
): string {
  if (!recs) return '';
  if (typeof recs === 'string') return recs;
  return recs
    .map((r, i) => {
      const lines = [`${i + 1}. ${r.action?.targetUrl ?? ''} (${r.action?.type ?? ''})`];
      if (r.evidence?.metric) lines.push(`   Evidence: ${r.evidence.metric}${r.evidence.dateRange ? ` (${r.evidence.dateRange})` : ''} [${r.evidence.source}]`);
      if (r.reasoning) lines.push(`   Reasoning: ${r.reasoning}`);
      if (r.action?.anchorText) lines.push(`   Link: "${r.action.anchorText}"${r.action.sourcePage ? ` from ${r.action.sourcePage}` : ''}`);
      const imp = r.expectedImpact;
      if (imp && (imp.estimate || imp.label)) lines.push(`   Expected impact: ${imp.estimate ?? 'directional'} [${imp.label}]`);
      return lines.join('\n');
    })
    .join('\n\n');
}

const NUMBER_RE = /\d/;
const ABSTRACT_TARGET_RE = /^(create|build|add|make|dedicated|various|relevant|several|multiple|new pages?)\b/i;

export interface RecommendationValidation {
  valid: boolean;
  warnings: string[];
}

export function validateRecommendations(recs: RecommendationInput[]): RecommendationValidation {
  const warnings: string[] = [];
  if (!Array.isArray(recs) || recs.length === 0) {
    return { valid: false, warnings: ['No recommendations provided — supply at least one structured recommendation.'] };
  }
  recs.forEach((r, i) => {
    const tag = `recommendation #${i + 1}`;
    if (!r?.evidence?.metric || !NUMBER_RE.test(r.evidence.metric))
      warnings.push(`${tag}: evidence.metric has no number — quote the exact figure from the tool (e.g. "111 impressions at pos 8.2"). Fix and re-call.`);
    if (!r?.reasoning || !/because/i.test(r.reasoning))
      warnings.push(`${tag}: reasoning must explain the causal link with "because…". Fix and re-call.`);
    if (!r?.action?.targetUrl || ABSTRACT_TARGET_RE.test(r.action.targetUrl.trim()))
      warnings.push(`${tag}: action.targetUrl is missing or abstract ("${r?.action?.targetUrl ?? ''}") — name the exact URL/slug, not an instruction. Fix and re-call.`);
    if (r?.action?.type === 'internal_link' && (!r.action.anchorText || !r.action.sourcePage))
      warnings.push(`${tag}: internal_link requires both anchorText and sourcePage (exact anchor + exact page it sits on). Fix and re-call.`);
    const estimate = r?.expectedImpact?.estimate;
    const hasNum = estimate ? NUMBER_RE.test(estimate) : false;
    if (!hasNum && r?.expectedImpact?.label === 'calculated')
      warnings.push(`${tag}: expectedImpact has no grounded number but is labelled "calculated" — set label "directional_not_calculated". Fix and re-call.`);
  });
  return { valid: warnings.length === 0, warnings };
}

export interface ProposedContentInput {
  proposedMetaTitle?: string;
  proposedMetaDescription?: string;
  proposedContent?: string;
  proposedSchema?: string | null;
  internalLinks?: { anchor: string; targetUrl: string }[];
}

export interface ProposedContentValidation {
  metaTitleLength: number;
  metaDescriptionLength: number;
  schemaValid: boolean | null;
  valid: boolean;
  warnings: string[];
}

export function validateProposedContent(args: ProposedContentInput): ProposedContentValidation {
  const warnings: string[] = [];
  const titleLen = args.proposedMetaTitle?.length ?? 0;
  const descLen = args.proposedMetaDescription?.length ?? 0;
  const content = args.proposedContent ?? '';

  if (titleLen > 60) warnings.push(`Meta title is ${titleLen} chars (recommended ≤60) — Google may truncate it. Shorten it and call this tool again.`);
  else if (titleLen > 0 && titleLen < 30) warnings.push(`Meta title is only ${titleLen} chars — use more of the available space (aim 50-60).`);
  if (descLen > 155) warnings.push(`Meta description is ${descLen} chars (recommended ≤155) — it may be truncated. Shorten it and call this tool again.`);
  else if (descLen > 0 && descLen < 70) warnings.push(`Meta description is only ${descLen} chars — expand toward ~150 for a fuller snippet.`);
  if (!/^#\s+\S/m.test(content)) warnings.push('Proposed content should start with a single H1 heading (# ...).');
  if (PLACEHOLDER_RE.test(content)) warnings.push('Proposed content contains placeholder text in brackets — replace it with real, production-ready copy and call this tool again.');
  if ((args.internalLinks?.length ?? 0) < 3) warnings.push('Fewer than 3 internal links suggested — propose more to strengthen internal linking.');

  // Validate JSON-LD is parseable so the user never gets broken schema
  let schemaValid: boolean | null = null;
  if (args.proposedSchema && args.proposedSchema.trim()) {
    try {
      JSON.parse(args.proposedSchema);
      schemaValid = true;
    } catch {
      schemaValid = false;
      warnings.push('proposedSchema is not valid JSON — fix the JSON-LD and call this tool again.');
    }
  }

  return {
    metaTitleLength: titleLen,
    metaDescriptionLength: descLen,
    schemaValid,
    valid: warnings.length === 0,
    warnings,
  };
}

// ── Faithfulness (Tier-1, deterministic) ─────────────────────────────────────
// Catches the "invented offerings" failure: services/sub-services in the draft
// that don't trace to the source page, retrieved pages, or the Brand Card.
// Heuristic by design (the scraper strips heading tags) — neverSay hits are a
// HARD fail; merely-unsupported offerings are advisory (surfaced for the owner)
// to avoid false-positive loops on generic section headings.

export interface GroundingContext {
  sourceContent: string; // source page cleanContent
  retrievedContent: string[]; // other retrieved site pages' content
  brandServices: string[]; // flat: real services + sub-services from the Brand Card
  brandNeverSay: string[]; // offerings the site explicitly does NOT have
}

export interface FaithfulnessResult {
  unsupportedOfferings: string[]; // appear in draft, absent from all grounding (advisory)
  forbiddenHits: string[]; // match the Brand Card neverSay list (hard fail)
  faithful: boolean; // false only when a forbidden offering is present
}

// Generic section names that are never "offerings" — don't flag them.
const GENERIC_HEADINGS = new Set(
  [
    'faq', 'faqs', 'frequently asked questions', 'overview', 'introduction',
    'conclusion', 'about', 'about us', 'contact', 'contact us', 'testimonials',
    'reviews', 'why choose us', 'why choose poirier', 'what we do', 'our services',
    'services', 'key takeaways', 'what is included', "what's included", 'get started',
    'how it works', 'who it is for', "who it's for", 'benefits', 'our process',
    'our team', 'team', 'pricing', 'features', 'next steps', 'summary',
  ].map((s) => s.toLowerCase()),
);

function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[*_`#>|]/g, ' ')
    .replace(/[^\p{L}\p{N}\s/&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Pull candidate offering names from the draft: H2/H3 headings and bullet-list leads.
function extractCandidateOfferings(content: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of content.split(/\n+/)) {
    const line = rawLine.trim();
    let candidate = '';
    const heading = line.match(/^#{2,4}\s+(.+)$/);
    const bullet = line.match(/^[-*+]\s+(.+)$/);
    if (heading) candidate = heading[1];
    else if (bullet) candidate = bullet[1];
    else continue;
    // A bullet that is a full sentence is prose, not an offering label.
    candidate = candidate.replace(/[:.!?]+$/, '').trim();
    if (!candidate) continue;
    const words = candidate.split(/\s+/);
    if (words.length > 6) continue; // long → prose, skip
    const norm = normalize(candidate);
    if (!norm || norm.length < 3) continue;
    if (GENERIC_HEADINGS.has(norm)) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(candidate);
  }
  return out;
}

export function checkFaithfulness(
  proposedContent: string,
  ctx: GroundingContext,
): FaithfulnessResult {
  const haystack = normalize(
    [ctx.sourceContent, ...ctx.retrievedContent, ...ctx.brandServices].join('\n'),
  );
  const neverSay = ctx.brandNeverSay.map(normalize).filter(Boolean);

  const forbiddenHits: string[] = [];
  for (const term of neverSay) {
    if (haystack.includes(term)) continue; // grounded elsewhere → not the model's invention
    // Flag if the forbidden offering appears anywhere in the draft.
    if (normalize(proposedContent).includes(term)) forbiddenHits.push(term);
  }

  const unsupportedOfferings: string[] = [];
  // Only attempt unsupported-offering detection when we have *some* grounding to
  // check against (otherwise everything looks unsupported → noise).
  if (haystack.length > 0) {
    for (const cand of extractCandidateOfferings(proposedContent)) {
      const norm = normalize(cand);
      // Supported if the candidate (or its head term) appears in the grounding.
      const head = norm.split(/\s+/).slice(0, 3).join(' ');
      if (haystack.includes(norm) || (head.length >= 4 && haystack.includes(head))) continue;
      unsupportedOfferings.push(cand);
    }
  }

  return {
    unsupportedOfferings,
    forbiddenHits: [...new Set(forbiddenHits)],
    faithful: forbiddenHits.length === 0,
  };
}
