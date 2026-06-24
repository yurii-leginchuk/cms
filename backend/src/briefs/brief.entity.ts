import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { RecommendationInput } from '../agent/tools/proposal-validation';

export type BriefStatus = 'draft' | 'in_progress' | 'applied';

@Entity('briefs')
@Index(['siteId', 'createdAt'])
export class Brief {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  // null for brand-new pages that don't exist yet
  @Column({ type: 'uuid', nullable: true })
  pageId: string | null;

  // User-supplied custom title for the brief. Falls back to the meta title /
  // page URL in the UI when null.
  @Column({ type: 'varchar', length: 255, nullable: true })
  name: string | null;

  @Column({ length: 2048 })
  pageUrl: string;

  @Column({ type: 'text', nullable: true })
  proposedMetaTitle: string | null;

  @Column({ type: 'text', nullable: true })
  proposedMetaDescription: string | null;

  @Column({ type: 'text', nullable: true })
  proposedSlug: string | null;

  @Column({ type: 'text', nullable: true })
  proposedContent: string | null;

  @Column({ type: 'text', nullable: true })
  proposedSchema: string | null;

  @Column({ type: 'text', nullable: true })
  keywordStrategy: string | null;

  @Column({ type: 'jsonb', nullable: true })
  internalLinks: { anchor: string; targetUrl: string }[] | null;

  @Column({ type: 'jsonb', nullable: true })
  recommendations: RecommendationInput[] | null;

  // Offerings/claims in the draft that did not trace to grounded site facts.
  // Rendered as an "unverified claims — confirm or remove" banner in the editor.
  @Column({ type: 'jsonb', nullable: true })
  unverifiedClaims: string[] | null;

  // Provenance: per-section source (page URL or Brand Card field) for auditability.
  @Column({ type: 'jsonb', nullable: true })
  sectionSources: { sectionHeading: string; source: string }[] | null;

  @Column({ type: 'varchar', length: 20, default: 'draft' })
  status: BriefStatus;

  // The date (YYYY-MM-DD) the brief was applied to the live site. Required while
  // status is 'applied'; cleared automatically when status moves off 'applied'.
  @Column({ type: 'date', nullable: true })
  appliedAt: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
