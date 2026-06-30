import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Meta editor — clear-on-WP support.
 *
 * pages.lastSyncedMeta: jsonb snapshot of the override fields the CMS last
 * successfully pushed to WordPress. The sync push compares the page's current
 * overrides against this snapshot so a field the CMS PREVIOUSLY applied but the
 * user has now cleared is sent as an explicit empty (the plugin deletes it),
 * while a field the CMS has never managed is still omitted — preserving the
 * "present-when-override" anti-clobber discipline.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddPageLastSyncedMeta1783100000000 implements MigrationInterface {
  name = 'AddPageLastSyncedMeta1783100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "lastSyncedMeta" jsonb`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" DROP COLUMN IF EXISTS "lastSyncedMeta"`,
    );
  }
}
