import { Brief } from '../brief.entity';
import { formatRecommendationsText } from '../../agent/tools/proposal-validation';

/** Escape a string for safe interpolation into HTML. Pure. */
export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function section(title: string, body: string): string {
  if (!body || !body.trim()) return '';
  return `<h2>${escapeHtml(title)}</h2>\n${body}\n`;
}

function paragraphs(text: string): string {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => `<p>${escapeHtml(p).replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

/**
 * Build a self-contained HTML document for a brief. Pure — no I/O.
 * Used both as the Google Docs media body (Drive converts HTML→Doc) and as a
 * human-readable artifact. ALL dynamic fields are HTML-escaped.
 */
export function buildBriefHtml(brief: Brief): string {
  const title = brief.proposedMetaTitle || brief.pageUrl || 'Content Brief';

  const metaBlock = [
    brief.proposedMetaTitle
      ? `<p><strong>Meta Title:</strong> ${escapeHtml(brief.proposedMetaTitle)}</p>`
      : '',
    brief.proposedMetaDescription
      ? `<p><strong>Meta Description:</strong> ${escapeHtml(brief.proposedMetaDescription)}</p>`
      : '',
    brief.pageUrl ? `<p><strong>Page URL:</strong> ${escapeHtml(brief.pageUrl)}</p>` : '',
    brief.proposedSlug ? `<p><strong>URL Slug:</strong> ${escapeHtml(brief.proposedSlug)}</p>` : '',
  ]
    .filter(Boolean)
    .join('\n');

  const linksBlock =
    brief.internalLinks && brief.internalLinks.length > 0
      ? '<ul>\n' +
        brief.internalLinks
          .map(
            (l) =>
              `<li>${escapeHtml(l.anchor)} &rarr; ${escapeHtml(l.targetUrl)}</li>`,
          )
          .join('\n') +
        '\n</ul>'
      : '';

  const schemaBlock = brief.proposedSchema
    ? `<pre>${escapeHtml(brief.proposedSchema)}</pre>`
    : '';

  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"/><title>${escapeHtml(title)}</title></head>
<body>
<h1>${escapeHtml(title)}</h1>
${section('SEO Metadata', metaBlock)}
${section('Proposed Content', brief.proposedContent ? paragraphs(brief.proposedContent) : '')}
${section('Keyword Strategy', brief.keywordStrategy ? paragraphs(brief.keywordStrategy) : '')}
${section('Internal Links', linksBlock)}
${section('Recommendations', brief.recommendations ? paragraphs(formatRecommendationsText(brief.recommendations)) : '')}
${section('Structured Data (JSON-LD)', schemaBlock)}
</body>
</html>`;
}
