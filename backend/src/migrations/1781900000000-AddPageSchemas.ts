import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema module — Phase 2 (AI analysis + managed schemas).
 * Creates `page_schemas`: the schemas we AUTHOR/approve for a page (distinct
 * from the detected-on-page snapshot in `pages.detectedSchemas`).
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddPageSchemas1781900000000 implements MigrationInterface {
  name = 'AddPageSchemas1781900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "page_schemas" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "pageId" uuid NOT NULL,
        "type" character varying(200) NOT NULL,
        "jsonld" jsonb NOT NULL,
        "status" character varying NOT NULL DEFAULT 'draft',
        "source" character varying NOT NULL DEFAULT 'human',
        "validationStatus" character varying(20) NOT NULL DEFAULT 'unvalidated',
        "validationResult" jsonb NOT NULL DEFAULT '[]',
        "aiRationale" text,
        "evidence" jsonb NOT NULL DEFAULT '[]',
        "unverifiedClaims" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_page_schemas" PRIMARY KEY ("id"),
        CONSTRAINT "FK_page_schemas_page" FOREIGN KEY ("pageId")
          REFERENCES "pages"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_page_schemas_pageId" ON "page_schemas" ("pageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "page_schemas"`);
  }
}
