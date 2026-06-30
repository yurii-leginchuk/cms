import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the `content_proposals` table. This was the pre-rename table that
 * `RenameContentProposalsToBriefs` superseded; dev's synchronize:true left it
 * behind as an orphan. With the briefs module fully removed, it is dead and is
 * reclaimed here.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true and never
 * runs the migration CLI, so the dev table is dropped directly out-of-band.
 *
 * down() is intentionally a no-op: the originating entity no longer exists, so
 * the table cannot be faithfully recreated. Restore from a backup if required.
 */
export class DropContentProposalsTable1782400100000 implements MigrationInterface {
  name = 'DropContentProposalsTable1782400100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "content_proposals"`);
  }

  public async down(): Promise<void> {
    // No-op — see class comment. The originating entity was deleted; the table
    // cannot be faithfully recreated. Restore from a backup if required.
  }
}
