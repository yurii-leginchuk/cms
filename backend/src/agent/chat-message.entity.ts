import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  ManyToOne,
  JoinColumn,
} from 'typeorm';
import { ChatSession } from './chat-session.entity';

@Entity('chat_messages')
export class ChatMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  sessionId: string;

  @ManyToOne(() => ChatSession, (session) => session.messages, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'sessionId' })
  session: ChatSession;

  @Column({ length: 20 })
  role: 'user' | 'assistant';

  @Column({ type: 'text', nullable: true })
  content: string | null;

  @Column({ type: 'jsonb', nullable: true })
  toolInvocations: any[] | null;

  @CreateDateColumn()
  createdAt: Date;
}
