import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  Index,
} from 'typeorm';

/**
 * A staged change PROPOSED by the MCP server (AI / Claude Code), held PENDING
 * until a human accepts or rejects it in the CMS. This is the human-approval
 * gate: MCP-originated edits never mutate the module's draft/managed state and
 * never publish to WordPress until accept(). Humans editing directly in the CMS
 * bypass this gate entirely (their edits do not create change requests).
 *
 *   accept = apply the proposed change to the module AND publish to WordPress.
 *   reject = discard.
 */
export type McpChangeModule = 'meta' | 'schema' | 'alt' | 'asana';
export type McpChangeStatus = 'pending' | 'accepted' | 'rejected';

/** Fine-grained action discriminator (drives accept() dispatch). */
export type McpChangeAction =
  | 'meta.update'
  | 'schema.add'
  | 'schema.update'
  | 'schema.delete'
  | 'alt.set'
  | 'asana.create'
  | 'asana.update'
  | 'asana.status'
  | 'asana.assignee'
  | 'asana.subtask'
  | 'asana.link';

@Entity('mcp_change_requests')
@Index(['siteId', 'status'])
@Index(['siteId', 'module', 'status'])
export class McpChangeRequest {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid' })
  siteId: string;

  @Column({ type: 'varchar', length: 16 })
  module: McpChangeModule;

  @Column({ type: 'varchar', length: 32 })
  action: McpChangeAction;

  /** What the change targets — used to dispatch + to render in the queue. */
  @Column({ type: 'varchar', length: 16 })
  targetType: 'page' | 'image' | 'task';

  /** UUID of the target page or image. */
  @Column({ type: 'varchar', length: 64 })
  targetId: string;

  /** Human-facing label (page url / image url) for the review UI. */
  @Column({ type: 'text', nullable: true })
  targetLabel: string | null;

  /** The proposed change (action-specific shape). */
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  /** Snapshot of the current state for the before → proposed diff. */
  @Column({ type: 'jsonb', nullable: true })
  before: Record<string, unknown> | null;

  /** Short human-readable description of the proposal. */
  @Column({ type: 'text' })
  summary: string;

  @Column({ type: 'varchar', length: 16, default: 'pending' })
  status: McpChangeStatus;

  @Column({ type: 'varchar', length: 16, default: 'mcp' })
  origin: string;

  /** Populated when accept() applies the change but publishing failed. */
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn()
  createdAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  decidedAt: Date | null;
}
