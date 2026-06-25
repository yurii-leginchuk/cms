import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';
import { IncidentScope, IncidentStatus, SecurityDetector, SecuritySeverity } from '../security.types';

/**
 * MUTABLE triage workflow. Findings sharing an incidentKey fold into one
 * incident (e.g. the same injected script across many pages = one incident).
 *
 * Locked product decision: a finding that recurs AFTER an incident was resolved
 * opens a NEW incident — resolved incidents are never reopened. Dismissing as a
 * false positive sets `suppressedPattern`, which silences future recurrences of
 * that exact key (alarm-fatigue guard).
 */
@Entity('security_incidents')
@Index(['siteId', 'status'])
@Index(['incidentKey', 'status'])
export class SecurityIncident {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid' }) siteId: string;

  /** Null for site-scoped incidents (pattern shared across pages). */
  @Column({ type: 'uuid', nullable: true }) pageId: string | null;

  @Column({ type: 'varchar', length: 64 }) incidentKey: string;
  @Column({ type: 'varchar', length: 10 }) scope: IncidentScope;
  @Column({ type: 'varchar', length: 40 }) detector: SecurityDetector;

  @Column({ type: 'varchar', length: 20 }) severity: SecuritySeverity;
  @Column({ type: 'varchar', length: 20, default: 'open' }) status: IncidentStatus;

  @Column({ type: 'text' }) title: string;

  @Column({ type: 'uuid' }) firstFindingId: string;
  @Column({ type: 'uuid' }) latestFindingId: string;

  @Column({ type: 'int', default: 1 }) affectedPageCount: number;

  @Column({ type: 'timestamp', nullable: true }) snoozedUntil: Date | null;

  /** Set when dismissed as false positive — suppresses future recurrences. */
  @Column({ type: 'boolean', default: false }) suppressedPattern: boolean;

  @Column({ type: 'timestamp', nullable: true }) resolvedAt: Date | null;

  @Column({ type: 'timestamp', nullable: true }) lastSeenAt: Date | null;

  @CreateDateColumn() createdAt: Date;
  @UpdateDateColumn() updatedAt: Date;
}
