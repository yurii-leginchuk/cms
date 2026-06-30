import {
  Entity, PrimaryGeneratedColumn, Column, CreateDateColumn, Index, Unique,
} from 'typeorm';

export type WatchedKeywordSource = 'manual' | 'semrush';

/**
 * A target query the user wants to monitor over time — the "are my keywords
 * ranking?" side of the Impact module. Scope mirrors page-scoped pins:
 *  - pageId null → monitor the query site-wide (GSC `query=…`, no page filter).
 *  - pageId set  → monitor the query ON that page (`query=…` AND `page=…`).
 *
 * The monitored set is intentionally bounded (user-chosen), which is what keeps
 * keyword tracking from degrading into an unbounded rank-tracker.
 */
@Entity('watched_keywords')
@Index(['siteId', 'pageId'])
@Unique(['siteId', 'pageId', 'normalizedQuery'])
export class WatchedKeyword {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'uuid', nullable: true })
  pageId: string | null;

  @Column({ type: 'varchar', length: 2048, nullable: true })
  pageUrl: string | null;

  @Column({ type: 'varchar', length: 255 })
  query: string;

  /** Lowercased/trimmed query for de-duplication within a (site, page) scope. */
  @Column({ type: 'varchar', length: 255 })
  normalizedQuery: string;

  @Column({ type: 'varchar', length: 16, default: 'manual' })
  source: WatchedKeywordSource;

  @CreateDateColumn()
  createdAt: Date;
}
