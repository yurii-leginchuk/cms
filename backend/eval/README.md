# Agent golden-set evals

Two layers guard the SEO agent against regressions:

## 1. Deterministic unit tests (free, run in CI)

Pure-logic guards that need no LLM and no running stack:

- `src/agent/workflow-intent.spec.ts` — intent routing (EN/RU/UA) for optimize / new-page / analytical.
- `src/agent/tools/proposal-validation.spec.ts` — meta length, placeholder, missing-H1, JSON-LD, internal-link checks.

```bash
npm test
```

Run these after any change to the system prompt, workflow routing, or proposal validation.

## 2. Live behavioral evals (costs tokens, run manually)

`golden-set.json` defines messages and asserts which tools the real agent picks
and what its proposal output looks like. Catches prompt regressions the unit
tests can't (e.g. the model stops calling `findStrikingDistanceKeywords` for
"quick wins").

Requires a running stack and a configured site:

```bash
EVAL_SITE_ID=<site-uuid> \
EVAL_PAGE_URL=https://example.com/some-page/ \
API_URL=http://localhost:3000 \
npm run eval
```

`EVAL_PAGE_URL` is optional; the optimize-with-schema case is skipped without it.
Exits non-zero if any case fails. Run before and after changing the system
prompt, workflow prompts, the model, or tool descriptions.
