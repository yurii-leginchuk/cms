import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { Page } from '../../pages/page.entity';
import {
  AxisFetchStatus,
  DetectorSignal,
  IncidentScope,
  SecurityDetector,
  SecuritySeverity,
} from '../security.types';

/**
 * IMMUTABLE evidence ledger. One row per (page, run) that produced any signal.
 * Never updated — both the input signals and the derived score/severity are
 * stored so the verdict is reproducible and auditable even after the rubric
 * version changes. Mutable triage state lives on SecurityIncident.
 */
@Entity('security_scan_findings')
@Index(['siteId', 'createdAt'])
@Index(['runId'])
@Index(['incidentKey'])
export class SecurityScanFinding {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid' }) runId: string;
  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'uuid' }) pageId: string;
  @Column({ type: 'text' }) pageUrl: string;

  /** Detector that contributed the dominant (highest-weight) signal. */
  @Column({ type: 'varchar', length: 40 }) dominantDetector: SecurityDetector;

  /** All emitted signals (detector inputs to the rubric), verbatim. */
  @Column({ type: 'jsonb', default: () => "'[]'" }) signals: DetectorSignal[];

  @Column({ type: 'int', default: 0 }) score: number;
  @Column({ type: 'varchar', length: 20 }) severity: SecuritySeverity;

  // Fetch outcome per axis (A = Googlebot, B = Chrome visitor).
  @Column({ type: 'varchar', length: 20 }) axisAStatus: AxisFetchStatus;
  @Column({ type: 'varchar', length: 20 }) axisBStatus: AxisFetchStatus;
  @Column({ type: 'int', nullable: true }) axisAHttpStatus: number | null;
  @Column({ type: 'int', nullable: true }) axisBHttpStatus: number | null;

  @Column({ type: 'jsonb', default: () => "'[]'" }) redirectChainA: { url: string; status: number }[];
  @Column({ type: 'jsonb', default: () => "'[]'" }) redirectChainB: { url: string; status: number }[];

  @Column({ type: 'uuid', nullable: true }) snapshotAId: string | null;
  @Column({ type: 'uuid', nullable: true }) snapshotBId: string | null;

  /** Bounded human-readable diff excerpt (≤ 8 KB). */
  @Column({ type: 'text', nullable: true }) excerpt: string | null;

  // Incident folding signature (computed deterministically in the processor).
  @Column({ type: 'varchar', length: 64 }) incidentKey: string;
  @Column({ type: 'varchar', length: 10 }) scope: IncidentScope;
  @Column({ type: 'varchar', length: 255 }) signature: string;

  @Column({ type: 'int', default: 1 }) rubricVersion: number;
  @Column({ type: 'int', default: 1 }) normalizationVersion: number;
  @Column({ type: 'int', default: 1 }) lexiconVersion: number;

  @CreateDateColumn() createdAt: Date;

  @ManyToOne(() => Page, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pageId' })
  page: Page;
}
