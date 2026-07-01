import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
} from 'typeorm';
import { Site } from '../sites/site.entity';
import { ChatMessage } from './chat-message.entity';

@Entity('chat_sessions')
export class ChatSession {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @ManyToOne(() => Site, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'siteId' })
  site: Site;

  @Column({ length: 255, nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  contextSummary: string | null;

  /**
   * How many of the session's oldest messages are already folded into
   * `contextSummary`. Lets each turn summarize only the NEW overflow instead of
   * re-summarizing the whole history every message past the threshold.
   */
  @Column({ type: 'int', default: 0 })
  summarizedCount: number;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;

  @OneToMany(() => ChatMessage, (msg) => msg.session, { cascade: true })
  messages: ChatMessage[];
}
