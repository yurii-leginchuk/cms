import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index,
} from 'typeorm';

/**
 * A user-pinned external event on the Optimization Impact timeline — e.g. a
 * Google core update, a site migration, a PR spike. External events are the
 * biggest confounder when reading our own changes against the curve; letting the
 * analyst mark them is cheap honesty.
 */
@Entity('impact_annotations')
@Index(['siteId', 'date'])
@Index(['siteId', 'pageId'])
export class ImpactAnnotation {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  /**
   * null → a site-wide external event (core update, migration) shown on every
   * timeline. Non-null → a pin scoped to one page, shown only on that page's
   * timeline and counted in the Impact pages list.
   */
  @Column({ type: 'uuid', nullable: true })
  pageId: string | null;

  @Column({ type: 'date' })
  date: string;

  @Column({ type: 'varchar', length: 200 })
  label: string;

  @CreateDateColumn()
  createdAt: Date;
}
