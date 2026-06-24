import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Renames content_proposals → briefs and migrates the status enum values.
 * Status mapping is kept consistent with src/briefs/status-migration.ts:
 *   draft        → draft
 *   meta_applied → page_optimized
 *   archived     → draft
 *
 * NOTE: this migration is for PRODUCTION (synchronize:false). Dev uses
 * synchronize:true and creates the `briefs` table directly.
 */
export class RenameContentProposalsToBriefs1781431385000
  implements MigrationInterface
{
  name = 'RenameContentProposalsToBriefs1781431385000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "content_proposals" RENAME TO "briefs"`);

    // Recreate the (siteId, createdAt) index with a deterministic name.
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_content_proposals_siteId_createdAt"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_briefs_siteId_createdAt" ON "briefs" ("siteId", "createdAt")`,
    );

    // Migrate legacy status values (kept in sync with STATUS_MAP).
    await queryRunner.query(
      `UPDATE "briefs" SET "status" = 'page_optimized' WHERE "status" = 'meta_applied'`,
    );
    await queryRunner.query(
      `UPDATE "briefs" SET "status" = 'draft' WHERE "status" = 'archived'`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Best-effort revert. NOTE: lossy — 'archived' rows were collapsed into
    // 'draft' on the way up and cannot be distinguished from real drafts now,
    // so they stay 'draft'. We only restore page_optimized → meta_applied.
    await queryRunner.query(
      `UPDATE "briefs" SET "status" = 'meta_applied' WHERE "status" = 'page_optimized'`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_briefs_siteId_createdAt"`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_content_proposals_siteId_createdAt" ON "briefs" ("siteId", "createdAt")`,
    );

    await queryRunner.query(`ALTER TABLE "briefs" RENAME TO "content_proposals"`);
  }
}
