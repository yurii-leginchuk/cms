import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * An append-only record of an ALT-text publish to the live site. WHY a dedicated
 * table instead of reading `site_images.lastPublishedAt` + live `image_placements`:
 * `lastPublishedAt` is OVERWRITTEN on every republish (no history), and placements
 * are reconciled (rows can vanish). Reading markers from those live rows would make
 * a historical ALT marker silently move or disappear. So we FREEZE, at publish time,
 * the immutable instant, the alt that went live, and the page-set as it was then.
 */
@Entity('alt_publish_events')
@Index(['siteId', 'publishedAt'])
@Index(['imageId'])
export class AltPublishEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid' })
  imageId: string;

  @Column({ type: 'varchar', length: 2048 })
  canonicalUrl: string;

  /** The immutable publish instant — the marker's date derives from this. */
  @Column({ type: 'timestamptz' })
  publishedAt: Date;

  /** The alt that went live ('' when cleared/removed). */
  @Column({ type: 'text' })
  altAfter: string;

  /** The page-set this image was placed on AT PUBLISH TIME (frozen, not live). */
  @Column({ type: 'jsonb', default: () => "'[]'" })
  pageIds: string[];

  @CreateDateColumn()
  createdAt: Date;
}
