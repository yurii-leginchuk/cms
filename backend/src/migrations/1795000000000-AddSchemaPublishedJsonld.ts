import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `page_schemas.publishedJsonld` — the JSON-LD as it currently lives on
 * WordPress. Maintained on publish/adopt/unpublish so a TARGETED publish (the
 * MCP gate accepting one change) can push the page's other pending rows at
 * their live baseline instead of leaking unapproved drafts.
 *
 * Backfill: `synced` rows mirror live by definition → copy their jsonld.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. IF NOT
 * EXISTS so it's safe to re-run.
 */
export class AddSchemaPublishedJsonld1795000000000 implements MigrationInterface {
  name = 'AddSchemaPublishedJsonld1795000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ADD COLUMN IF NOT EXISTS "publishedJsonld" jsonb`,
    );
    await queryRunner.query(
      `UPDATE "page_schemas" SET "publishedJsonld" = "jsonld" WHERE "status" = 'synced' AND "publishedJsonld" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "page_schemas" DROP COLUMN IF EXISTS "publishedJsonld"`,
    );
  }
}
