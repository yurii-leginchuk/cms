import { BriefStatus } from './brief.entity';

/**
 * Maps legacy statuses to the current Brief status set
 * (draft | in_progress | applied).
 * - draft           → draft (unchanged)
 * - meta_applied    → applied   (legacy content_proposals)
 * - archived        → draft     (archive concept removed)
 * - seo_qc_complete → in_progress (renamed)
 * - page_optimized  → applied     (renamed)
 * Anything unknown falls back to draft.
 */
export const STATUS_MAP: Record<string, BriefStatus> = {
  draft: 'draft',
  meta_applied: 'applied',
  archived: 'draft',
  seo_qc_complete: 'in_progress',
  page_optimized: 'applied',
};

export function mapLegacyStatus(status: string): BriefStatus {
  return STATUS_MAP[status] ?? 'draft';
}
