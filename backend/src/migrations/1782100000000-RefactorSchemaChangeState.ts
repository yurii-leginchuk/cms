import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Schema module — change-state refactor.
 *
 * Detection now auto-persists into `page_schemas` as the canonical managed set,
 * and the per-row `status` becomes a change-state vs. what's live on WordPress:
 *   synced   — matches live / freshly detected baseline (not a pending change)
 *   modified — added or edited, pending Apply
 *   removed  — soft-deleted, pending Apply
 *
 * Old values map: draft/approved/published -> synced, archived -> removed.
 *
 * Done via text round-trip so the Postgres enum type can be safely replaced even
 * with existing rows. PRODUCTION migration (synchronize:false). Dev uses
 * synchronize:true, but this mirrors the change for prod parity.
 */
export class RefactorSchemaChangeState1782100000000
  implements MigrationInterface
{
  name = 'RefactorSchemaChangeState1782100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Detach the column from the old enum.
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ALTER COLUMN "status" TYPE text USING "status"::text`,
    );

    // 2. Remap legacy values to the new change-state vocabulary.
    await queryRunner.query(
      `UPDATE "page_schemas" SET "status" = 'synced' WHERE "status" IN ('draft','approved','published')`,
    );
    await queryRunner.query(
      `UPDATE "page_schemas" SET "status" = 'removed' WHERE "status" = 'archived'`,
    );

    // 3. Replace the enum type.
    await queryRunner.query(`DROP TYPE IF EXISTS "page_schemas_status_enum"`);
    await queryRunner.query(
      `CREATE TYPE "page_schemas_status_enum" AS ENUM ('synced','modified','removed')`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ALTER COLUMN "status" TYPE "page_schemas_status_enum" USING "status"::"page_schemas_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ALTER COLUMN "status" SET DEFAULT 'synced'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ALTER COLUMN "status" DROP DEFAULT`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ALTER COLUMN "status" TYPE text USING "status"::text`,
    );
    await queryRunner.query(
      `UPDATE "page_schemas" SET "status" = 'approved' WHERE "status" IN ('synced','modified')`,
    );
    await queryRunner.query(
      `UPDATE "page_schemas" SET "status" = 'archived' WHERE "status" = 'removed'`,
    );
    await queryRunner.query(`DROP TYPE IF EXISTS "page_schemas_status_enum"`);
    await queryRunner.query(
      `CREATE TYPE "page_schemas_status_enum" AS ENUM ('draft','approved','published','archived')`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ALTER COLUMN "status" TYPE "page_schemas_status_enum" USING "status"::"page_schemas_status_enum"`,
    );
    await queryRunner.query(
      `ALTER TABLE "page_schemas" ALTER COLUMN "status" SET DEFAULT 'draft'`,
    );
  }
}
