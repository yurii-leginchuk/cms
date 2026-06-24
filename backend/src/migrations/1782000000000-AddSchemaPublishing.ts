import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema module — Phase 3 (publish to WordPress).
 *  - `page_schemas.lastPublishedAt` / `.publishError`: per-schema push state.
 *  - `schema_history`: immutable snapshot of each published set (audit + rollback).
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddSchemaPublishing1782000000000 implements MigrationInterface {
  name = 'AddSchemaPublishing1782000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ADD COLUMN IF NOT EXISTS "lastPublishedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ADD COLUMN IF NOT EXISTS "publishError" text`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "schema_history" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "pageId" uuid NOT NULL,
        "snapshot" jsonb NOT NULL,
        "count" integer NOT NULL DEFAULT 0,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_schema_history" PRIMARY KEY ("id"),
        CONSTRAINT "FK_schema_history_page" FOREIGN KEY ("pageId")
          REFERENCES "pages"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_schema_history_pageId" ON "schema_history" ("pageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "schema_history"`);
    await queryRunner.query(
      `ALTER TABLE "page_schemas" DROP COLUMN IF EXISTS "publishError"`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_schemas" DROP COLUMN IF EXISTS "lastPublishedAt"`,
    );
  }
}
