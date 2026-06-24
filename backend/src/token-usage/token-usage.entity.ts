import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

export type TokenFeature =
  | 'meta_generation'
  | 'agent_chat'
  | 'jina_scraping'
  | 'schema_generation'
  | 'alt_generation';

@Entity('token_usage')
export class TokenUsage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index()
  @Column({ type: 'uuid', nullable: true })
  siteId: string | null;

  @Index()
  @Column({ type: 'varchar', length: 50 })
  feature: TokenFeature;

  @Column({ type: 'varchar', length: 100 })
  model: string;

  @Column({ type: 'int', default: 0 })
  inputTokens: number;

  @Column({ type: 'int', default: 0 })
  outputTokens: number;

  @Column({ type: 'int', default: 0 })
  totalTokens: number;

  @Column({ type: 'decimal', precision: 10, scale: 6, default: 0 })
  estimatedCostUsd: number;

  @Index()
  @CreateDateColumn()
  createdAt: Date;
}
