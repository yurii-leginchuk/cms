import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

@Entity('gsc_cache')
export class GscCache {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index({ unique: true })
  @Column({ length: 64 })
  cacheKey: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'jsonb' })
  queryParams: Record<string, unknown>;

  @Column({ type: 'jsonb' })
  data: Record<string, unknown>;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @CreateDateColumn()
  createdAt: Date;
}
