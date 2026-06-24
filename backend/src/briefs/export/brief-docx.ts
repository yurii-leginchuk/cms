import {
  Document,
  Paragraph,
  HeadingLevel,
  TextRun,
  Table,
  TableRow,
  TableCell,
  WidthType,
} from 'docx';
import { Brief } from '../brief.entity';
import { formatRecommendationsText } from '../../agent/tools/proposal-validation';

function heading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_1 });
}

function subHeading(text: string): Paragraph {
  return new Paragraph({ text, heading: HeadingLevel.HEADING_2 });
}

function labelled(label: string, value: string): Paragraph {
  return new Paragraph({
    children: [
      new TextRun({ text: `${label}: `, bold: true }),
      new TextRun({ text: value }),
    ],
  });
}

function bodyParagraphs(text: string): Paragraph[] {
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => new Paragraph({ children: [new TextRun({ text: p })] }));
}

/**
 * Build a docx Document for a brief. Pure (no I/O). Caller turns it into a
 * Buffer via Packer.toBuffer().
 */
export function buildBriefDocx(brief: Brief): Document {
  const children: (Paragraph | Table)[] = [];

  children.push(heading(brief.proposedMetaTitle || brief.pageUrl || 'Content Brief'));

  children.push(subHeading('SEO Metadata'));
  if (brief.proposedMetaTitle) children.push(labelled('Meta Title', brief.proposedMetaTitle));
  if (brief.proposedMetaDescription)
    children.push(labelled('Meta Description', brief.proposedMetaDescription));
  if (brief.pageUrl) children.push(labelled('Page URL', brief.pageUrl));
  if (brief.proposedSlug) children.push(labelled('URL Slug', brief.proposedSlug));

  if (brief.proposedContent) {
    children.push(subHeading('Proposed Content'));
    children.push(...bodyParagraphs(brief.proposedContent));
  }

  if (brief.keywordStrategy) {
    children.push(subHeading('Keyword Strategy'));
    children.push(...bodyParagraphs(brief.keywordStrategy));
  }

  if (brief.internalLinks && brief.internalLinks.length > 0) {
    children.push(subHeading('Internal Links'));
    children.push(
      new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        rows: [
          new TableRow({
            children: [
              new TableCell({
                width: { size: 40, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: 'Anchor', bold: true })] })],
              }),
              new TableCell({
                width: { size: 60, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: 'Target URL', bold: true })] })],
              }),
            ],
          }),
          ...brief.internalLinks.map(
            (l) =>
              new TableRow({
                children: [
                  new TableCell({
                    width: { size: 40, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ text: l.anchor })],
                  }),
                  new TableCell({
                    width: { size: 60, type: WidthType.PERCENTAGE },
                    children: [new Paragraph({ text: l.targetUrl })],
                  }),
                ],
              }),
          ),
        ],
      }),
    );
  }

  if (brief.recommendations) {
    children.push(subHeading('Recommendations'));
    children.push(...bodyParagraphs(formatRecommendationsText(brief.recommendations)));
  }

  if (brief.proposedSchema) {
    children.push(subHeading('Structured Data (JSON-LD)'));
    children.push(new Paragraph({ children: [new TextRun({ text: brief.proposedSchema })] }));
  }

  return new Document({ sections: [{ children }] });
}
