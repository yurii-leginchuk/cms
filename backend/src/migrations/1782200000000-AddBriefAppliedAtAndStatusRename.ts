import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the briefs.appliedAt column and renames the status enum values to the
 * current set (draft | in_progress | applied):
 *   seo_qc_complete → in_progress
 *   page_optimized  → applied
 *
 * Kept in sync with src/briefs/status-migration.ts (STATUS_MAP).
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddBriefAppliedAtAndStatusRename1782200000000
  implements MigrationInterface
{
  name = 'AddBriefAppliedAtAndStatusRename1782200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "appliedAt" date`,
    );

    await queryRunner.query(
      `UPDATE "briefs" SET "status" = 'in_progress' WHERE "status" = 'seo_qc_complete'`,
    );
    await queryRunner.query(
      `UPDATE "briefs" SET "status" = 'applied' WHERE "status" = 'page_optimized'`,
    );

    // Backfill a best-effort applied date for rows that are now 'applied' but
    // have no date, so they satisfy the new "applied requires a date" rule.
    await queryRunner.query(
      `UPDATE "briefs" SET "appliedAt" = "updatedAt"::date WHERE "status" = 'applied' AND "appliedAt" IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Reverse the status rename. NOTE: lossy — 'applied' rows that originated
    // from legacy meta_applied are indistinguishable from page_optimized, so
    // all 'applied' rows revert to 'page_optimized'.
    await queryRunner.query(
      `UPDATE "briefs" SET "status" = 'page_optimized' WHERE "status" = 'applied'`,
    );
    await queryRunner.query(
      `UPDATE "briefs" SET "status" = 'seo_qc_complete' WHERE "status" = 'in_progress'`,
    );

    await queryRunner.query(
      `ALTER TABLE "briefs" DROP COLUMN IF EXISTS "appliedAt"`,
    );
  }
}
