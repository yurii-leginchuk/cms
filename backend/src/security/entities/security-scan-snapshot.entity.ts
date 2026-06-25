import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index } from 'typeorm';
import { SecurityAxis } from '../security.types';

/**
 * Normalized content captured for one (page, axis) during a scan. Deduplicated
 * by contentHash — identical normalized content reuses a row — so storing both
 * the Googlebot-view and visitor-view across nights stays cheap. Findings point
 * at two snapshots (A = bot, B = visitor) to power the side-by-side diff.
 */
@Entity('security_scan_snapshots')
@Index(['siteId', 'pageId', 'axis', 'createdAt'])
// Per-(page,axis) dedup: re-scanning an unchanged page reuses the row.
@Index(['pageId', 'axis', 'contentHash'], { unique: true })
export class SecurityScanSnapshot {
  @PrimaryGeneratedColumn('uuid') id: string;

  @Column({ type: 'uuid' }) siteId: string;
  @Column({ type: 'uuid' }) pageId: string;

  @Column({ type: 'varchar', length: 20 }) axis: SecurityAxis;

  @Column({ type: 'varchar', length: 64 }) contentHash: string;

  @Column({ type: 'text' }) normalizedContent: string;

  @Column({ type: 'jsonb', default: () => "'[]'" }) externalScriptOrigins: string[];
  @Column({ type: 'jsonb', default: () => "'[]'" }) externalLinkDomains: string[];

  @Column({ type: 'int', default: 0 }) rawByteLength: number;

  @Column({ type: 'int', default: 1 }) normalizationVersion: number;

  @CreateDateColumn() createdAt: Date;
}
