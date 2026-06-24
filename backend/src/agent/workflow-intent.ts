// Lightweight intent router — decide which workflow prompt (if any) to inject.
// Saves tokens and sharpens focus by not loading both workflows on every turn.
// Kept as a standalone pure function so it can be unit-tested without the agent stack.
export type WorkflowIntent = 'optimize' | 'new_page' | null;

export function detectWorkflowIntent(msg: string): WorkflowIntent {
  const hasUrl = /https?:\/\//i.test(msg);
  // EN + RU + UA cues.
  // NOTE: do NOT wrap Cyrillic alternatives in `\b` — JS `\b` is ASCII-only
  // (Cyrillic chars aren't `\w`), so boundaries never match around them.
  // English audit keeps a boundary to avoid matching inside words like "auditory".
  const newPage = /(new page|create (a )?page|generate (a )?page|build (a )?page|write a new page|нов(ая|ую) страниц|создай страниц|сгенерируй страниц|нов(а|у) сторінк|створи сторінк|згенеруй сторінк)/i;
  const optimize = /(optimi[sz]e|improve|rewrite|re-write|revamp|\baudit\b|оптимиз|оптиміз|улучш|покращ|перепиш|переписат|переробит|доработа|аудит)/i;
  // Meta-only rewrites ("change/update the meta title|description", RU/UA equivalents)
  // are an optimize intent too — they must end with a proposeMetaUpdate call (Defect D-D).
  const metaEdit = /((change|update|edit|fix|redo)\b[^.!?]*\b(meta|title|description)|(meta\s*(title|description))|(измени|обнови|поменяй|исправь)[^.!?]*(мета|тайтл|заголов|описан)|(зміни|онови|виправ)[^.!?]*(мета|тайтл|заголов|опис))/i;
  if (newPage.test(msg)) return 'new_page';
  if (optimize.test(msg) || metaEdit.test(msg) || hasUrl) return 'optimize';
  return null;
}
