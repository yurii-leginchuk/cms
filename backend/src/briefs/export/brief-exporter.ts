import { Brief } from '../brief.entity';

export type BriefExportResult =
  | { kind: 'docx'; buffer: Buffer; filename: string }
  | { kind: 'gdoc'; url: string };

export interface BriefExporter {
  export(brief: Brief): Promise<BriefExportResult>;
}

export const BRIEF_EXPORTER = Symbol('BRIEF_EXPORTER');

/** Build a safe download filename from a brief. */
export function briefFilename(brief: Brief): string {
  const base = (brief.proposedSlug || brief.id || 'brief')
    .toString()
    .replace(/[^a-z0-9-_]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase();
  return `content-brief-${base || 'brief'}.docx`;
}
