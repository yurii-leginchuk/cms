# Integrate Agent

When a new CMS feature has been implemented, integrate it with the AI agent and prepare it for future RAG support.

## What to do

1. **Identify new data** — Look at recently added/modified entities, services, and endpoints
2. **Create agent tools** — Add relevant read tools to `backend/src/agent/tools/`
3. **Create proposal tools** — If the feature allows mutations, add proposal tools (they return proposals, don't mutate)
4. **Register tools** — Add new tools to `AgentService.streamChat()` tool list
5. **Update system prompt** — If the agent needs to know about the new capability, update the system prompt in `AgentService`
6. **RAG annotation** — Add a comment `// RAG: <what content would be embedded and why>` near any new text/content fields that would benefit from semantic search
7. **Test** — Ask the agent "what can you tell me about [new feature]" to verify tools work

## Tool naming conventions
- Read tools: verb + noun (`getGscReport`, `listKeywordRankings`)
- Proposal tools: `propose` + action (`proposeCanonicalChange`)
- Tools are scoped to current siteId via closure (already injected)

## RAG readiness checklist
- [ ] Does the new feature store large text content? → Add `embedding vector(1536)` column
- [ ] Would users want semantic search ("find pages about X")? → Plan pgvector query tool
- [ ] Are there external documents (PDFs, reports)? → Plan document chunking pipeline
