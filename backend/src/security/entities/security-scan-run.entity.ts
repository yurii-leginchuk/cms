import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { ScanRunStatus } from '../security.types';

/**
 * Lineage anchor: one nightly (or manual) scan pass for a site. All findings of
 * a pass point back to their run, so a finding is always attributable to a known
 * rubric / lexicon / normalization version.
 */
@Entity('security_scan_runs')
@Index(['siteId', 'createdAt'])
export class SecurityScanRun {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid' }) siteId: string;

  @Column({ type: 'varchar', length: 20, default: 'running' }) status: ScanRunStatus;

  @Column({ type: 'int', default: 0 }) pagesTotal: number;
  @Column({ type: 'int', default: 0 }) pagesScanned: number;
  @Column({ type: 'int', default: 0 }) pagesUnreachable: number;
  @Column({ type: 'int', default: 0 }) findingsCount: number;

  @Column({ type: 'timestamp', nullable: true }) startedAt: Date | null;
  @Column({ type: 'timestamp', nullable: true }) finishedAt: Date | null;

  // Versions in force for this run (also copied onto each finding).
  @Column({ type: 'int', default: 1 }) rubricVersion: number;
  @Column({ type: 'int', default: 1 }) normalizationVersion: number;
  @Column({ type: 'int', default: 1 }) lexiconVersion: number;

  @CreateDateColumn() createdAt: Date;
}
