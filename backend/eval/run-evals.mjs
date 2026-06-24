#!/usr/bin/env node
/**
 * Live golden-set eval runner for the SEO agent.
 *
 * Sends each case's message to a running agent, parses the streamed tool calls
 * and outputs, and asserts on them. Catches prompt/routing regressions that the
 * deterministic unit tests cannot (real LLM behavior).
 *
 * Usage:
 *   EVAL_SITE_ID=<uuid> [EVAL_PAGE_URL=<url>] [API_URL=http://localhost:3000] \
 *     node eval/run-evals.mjs
 *
 * Exits non-zero if any case fails. Costs real API tokens — run before/after
 * changing the system prompt or workflows.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const API_URL = process.env.API_URL || 'http://localhost:3000';
const SITE_ID = process.env.EVAL_SITE_ID;
const PAGE_URL = process.env.EVAL_PAGE_URL || '';

if (!SITE_ID) {
  console.error('✗ EVAL_SITE_ID is required (a configured site UUID).');
  process.exit(2);
}

const { cases } = JSON.parse(readFileSync(join(__dirname, 'golden-set.json'), 'utf8'));

async function createSession() {
  const res = await fetch(`${API_URL}/api/agent/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ siteId: SITE_ID }),
  });
  if (!res.ok) throw new Error(`createSession failed: HTTP ${res.status}`);
  const body = await res.json();
  return body.data.id;
}

/** Stream a chat turn and collect tool names + proposal outputs + text. */
async function runTurn(sessionId, message) {
  const res = await fetch(`${API_URL}/api/agent/sessions/${sessionId}/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message }),
  });
  if (!res.ok && res.status !== 200) throw new Error(`chat failed: HTTP ${res.status}`);

  const text = await res.text();
  const tools = new Set();
  const proposals = [];
  let answer = '';

  for (let line of text.split('\n')) {
    line = line.trim();
    if (line.startsWith('data:')) line = line.slice(5).trim();
    if (!line.startsWith('{')) continue;
    let evt;
    try { evt = JSON.parse(line); } catch { continue; }
    if (evt.toolName) tools.add(evt.toolName);
    if (evt.type === 'tool-output-available' && evt.output && typeof evt.output === 'object') {
      if (evt.output.type === 'proposal') proposals.push(evt.output);
    }
    if (evt.type === 'text-delta' && typeof evt.delta === 'string') answer += evt.delta;
  }
  return { tools: [...tools], proposals, answer };
}

function evaluate(c, result) {
  const fails = [];
  const have = new Set(result.tools);

  if (c.expectTools) {
    for (const t of c.expectTools) {
      if (!have.has(t)) fails.push(`expected tool "${t}" was not called`);
    }
  }
  if (c.expectAnyTools) {
    if (!c.expectAnyTools.some((t) => have.has(t))) {
      fails.push(`expected at least one of [${c.expectAnyTools.join(', ')}], got [${result.tools.join(', ')}]`);
    }
  }
  if (c.forbidProposal && result.proposals.length > 0) {
    fails.push(`did not expect a proposal but got ${result.proposals.length}`);
  }
  if (c.expectProposalSchemaValid) {
    const content = result.proposals.find((p) => p.action === 'content_proposal');
    if (!content) fails.push('expected a content_proposal but none was produced');
    else if (content.validation && content.validation.schemaValid === false) {
      fails.push('content_proposal produced invalid JSON-LD schema');
    }
  }

  // Proposal 9 — every recommendation is a structured 4-part argument.
  if (c.expectStructuredRecommendations) {
    const content = result.proposals.find((p) => p.action === 'content_proposal');
    if (!content) fails.push('expected a content_proposal with structured recommendations');
    else {
      const recs = content.recommendations;
      if (!Array.isArray(recs) || recs.length === 0) fails.push('recommendations is not a non-empty array');
      else
        recs.forEach((r, i) => {
          if (!r?.evidence?.metric || !/\d/.test(r.evidence.metric)) fails.push(`rec #${i + 1}: evidence.metric missing/has no number`);
          if (!r?.evidence?.source) fails.push(`rec #${i + 1}: evidence.source missing`);
          if (!r?.reasoning || !/because/i.test(r.reasoning)) fails.push(`rec #${i + 1}: reasoning missing "because"`);
          if (!r?.action?.targetUrl || /^(create|build|add|dedicated)\b/i.test(r.action.targetUrl)) fails.push(`rec #${i + 1}: action.targetUrl missing or abstract`);
          if (r?.action?.type === 'internal_link' && (!r.action.anchorText || !r.action.sourcePage)) fails.push(`rec #${i + 1}: internal_link missing anchorText/sourcePage`);
          if (!r?.expectedImpact?.label) fails.push(`rec #${i + 1}: expectedImpact.label missing`);
        });
      if (content.validation && content.validation.valid === false) fails.push('content_proposal validation.valid is false (unfixed warnings)');
    }
  }

  // Faithfulness — no fabricated offerings (forbidden or unsupported) in the final draft.
  if (c.assertFaithful) {
    const content = result.proposals.find((p) => p.action === 'content_proposal');
    if (!content) fails.push('expected a content_proposal to assert faithfulness on');
    else {
      const f = content.faithfulness ?? content.validation;
      if (f && f.faithful === false) fails.push(`content_proposal is unfaithful — forbidden offerings: [${(content.faithfulness?.forbiddenHits ?? []).join(', ')}]`);
      const unsupported = content.faithfulness?.unsupportedOfferings ?? content.validation?.unsupportedOfferings ?? [];
      if (c.forbidUnsupportedOfferings && unsupported.length > 0) fails.push(`content_proposal has ungrounded offerings: [${unsupported.join(', ')}]`);
    }
  }
  return fails;
}

async function main() {
  console.log(`\n▶ Golden-set eval against ${API_URL} (site ${SITE_ID})\n`);
  let passed = 0;
  let failed = 0;
  let skipped = 0;

  for (const c of cases) {
    if (c.requiresPageUrl && !PAGE_URL) {
      console.log(`  ⊘ ${c.id} — skipped (set EVAL_PAGE_URL to run)`);
      skipped++;
      continue;
    }
    const message = c.message.replace('{PAGE_URL}', PAGE_URL);
    try {
      const sessionId = await createSession();
      const result = await runTurn(sessionId, message);
      const fails = evaluate(c, result);
      if (fails.length === 0) {
        console.log(`  ✓ ${c.id}  [tools: ${result.tools.join(', ') || 'none'}]`);
        passed++;
      } else {
        console.log(`  ✗ ${c.id}`);
        for (const f of fails) console.log(`      - ${f}`);
        console.log(`      tools called: [${result.tools.join(', ') || 'none'}]`);
        failed++;
      }
    } catch (err) {
      console.log(`  ✗ ${c.id} — error: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed, ${skipped} skipped\n`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
