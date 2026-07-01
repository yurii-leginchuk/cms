import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `chat_sessions.summarizedCount` — how many of the oldest messages are
 * already folded into `contextSummary`, so long sessions summarize only the new
 * overflow each turn instead of re-summarizing the whole history every message.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. IF NOT
 * EXISTS so it's safe to re-run.
 */
export class AddChatSummarizedCount1796000000000 implements MigrationInterface {
  name = 'AddChatSummarizedCount1796000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_sessions" ADD COLUMN IF NOT EXISTS "summarizedCount" integer NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "chat_sessions" DROP COLUMN IF EXISTS "summarizedCount"`,
    );
  }
}
