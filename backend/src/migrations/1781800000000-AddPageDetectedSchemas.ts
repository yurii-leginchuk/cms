import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema module — Phase 1 (detection + validation).
 *  - `pages.detectedSchemas` (jsonb): last JSON-LD detection + schema.org
 *    validation snapshot for the page.
 *  - `pages.schemaCheckedAt` (timestamp): when that snapshot was produced.
 *
 * Both nullable: pages stay valid until their schema is first checked.
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddPageDetectedSchemas1781800000000 implements MigrationInterface {
  name = 'AddPageDetectedSchemas1781800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "detectedSchemas" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "schemaCheckedAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" DROP COLUMN IF EXISTS "schemaCheckedAt"`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" DROP COLUMN IF EXISTS "detectedSchemas"`,
    );
  }
}
