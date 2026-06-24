import {
  Entity,
  PrimaryColumn,
  Column,
  UpdateDateColumn,
} from 'typeorm';

@Entity('site_briefs')
export class SiteBrief {
  @PrimaryColumn({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'text', nullable: true })
  keywordCsv: string | null;

  @Column({ type: 'text', nullable: true })
  clientNotes: string | null;

  @Column({ type: 'text', nullable: true })
  pastPageExample: string | null;

  @Column({ type: 'text', nullable: true })
  locations: string | null;

  @Column({ length: 20, nullable: true })
  spellingVariant: string | null;

  @Column({ type: 'text', nullable: true })
  approvedCtas: string | null;

  @Column({ type: 'text', nullable: true })
  complianceNotes: string | null;

  @UpdateDateColumn()
  updatedAt: Date;
}
