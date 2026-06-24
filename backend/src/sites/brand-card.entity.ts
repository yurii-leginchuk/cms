import { Entity, PrimaryColumn, Column, UpdateDateColumn } from 'typeorm';

/**
 * Canonical, structured ground truth about a site — the "what actually exists" layer.
 *
 * This is the allow-list the assistant writes copy FROM and is validated AGAINST
 * (see GENERATION GROUNDING CONTRACT in agent.service.ts and checkFaithfulness in
 * proposal-validation.ts). It is auto-derived from already-crawled pages
 * (BrandCardService.deriveDraft) and then human-confirmed (`reviewed`).
 *
 * Distinct from SiteBrief (free-text SEMrush/client notes). The Brand Card is the
 * structured, machine-checkable catalog of real offerings/people/claims.
 */
export interface ServiceEntry {
  name: string;
  slug?: string | null;
  sourceUrl: string;
  subServices: string[];
}

export interface PersonEntry {
  name: string;
  role?: string | null;
  sourceUrl?: string | null;
}

export interface CtaEntry {
  label: string;
  url?: string | null;
  phone?: string | null;
}

@Entity('brand_cards')
export class BrandCard {
  @PrimaryColumn({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 200, nullable: true })
  brandName: string | null;

  @Column({ type: 'varchar', length: 80, nullable: true })
  spelling: string | null;

  // Brand query terms (lowercased) used to split branded vs non-branded Search
  // Console traffic on the Optimization Impact timeline. Matched against the GSC
  // `query` dimension via excludingRegex (non-branded = everything NOT matching).
  // Empty = no split (all traffic treated as non-branded).
  @Column({ type: 'jsonb', default: () => "'[]'" })
  brandTerms: string[];

  // THE service catalog — exhaustive list of real offerings with on-page sub-services.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  services: ServiceEntry[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  locations: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  people: PersonEntry[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  certifications: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  approvedClaims: string[];

  // Offerings/claims the site explicitly does NOT make — the hard "never mention" list.
  @Column({ type: 'jsonb', default: () => "'[]'" })
  neverSay: string[];

  @Column({ type: 'jsonb', default: () => "'[]'" })
  ctas: CtaEntry[];

  // false = auto-derived draft (inject as "unverified"); true = human-confirmed authoritative.
  @Column({ type: 'boolean', default: false })
  reviewed: boolean;

  @UpdateDateColumn()
  updatedAt: Date;
}
