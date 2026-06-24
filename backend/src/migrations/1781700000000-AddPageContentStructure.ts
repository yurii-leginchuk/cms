import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Structured page content (Phase 1).
 *  - adds `pages.contentStructure` (jsonb): the canonical, section-addressable
 *    representation parsed from Jina markdown / the readability fallback.
 *
 * `cleanContent` is kept and is now DERIVED from the structure, so all existing
 * readers (embeddings, agent, meta generation, faithfulness) keep working.
 * Nullable: already-scraped pages stay valid until re-parsed.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddPageContentStructure1781700000000 implements MigrationInterface {
  name = 'AddPageContentStructure1781700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "contentStructure" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" DROP COLUMN IF EXISTS "contentStructure"`,
    );
  }
}
