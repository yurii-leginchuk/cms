import { Entity, PrimaryGeneratedColumn, Column, Index } from 'typeorm';

@Entity('crux_results')
@Index(['siteId'])
@Index(['pageId'])
export class CruxResult {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid' }) pageId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'text' }) url: string;

  @Column({ type: 'varchar', length: 20 }) formFactor: string; // PHONE | DESKTOP

  @Column({ type: 'boolean', default: false }) hasData: boolean;
  @Column({ type: 'boolean', default: false }) isOriginFallback: boolean;

  // p75 field values
  @Column({ type: 'int', nullable: true }) lcpP75: number | null;   // ms
  @Column({ type: 'real', nullable: true }) clsP75: number | null;  // unitless
  @Column({ type: 'int', nullable: true }) fcpP75: number | null;   // ms
  @Column({ type: 'int', nullable: true }) inpP75: number | null;   // ms (replaces FID)
  @Column({ type: 'int', nullable: true }) ttfbP75: number | null;  // ms

  // good | needs_improvement | poor
  @Column({ type: 'varchar', nullable: true }) lcpCategory: string | null;
  @Column({ type: 'varchar', nullable: true }) clsCategory: string | null;
  @Column({ type: 'varchar', nullable: true }) fcpCategory: string | null;
  @Column({ type: 'varchar', nullable: true }) inpCategory: string | null;

  @Column({ type: 'timestamp' }) fetchedAt: Date;
}
