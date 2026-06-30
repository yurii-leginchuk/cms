import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops the `briefs` content-brief table. The briefs module (entity, controller,
 * service, DTOs, exports) was removed from the application, leaving this table
 * orphaned. This migration reclaims it.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true and never
 * runs the migration CLI, so the dev table is dropped directly out-of-band.
 *
 * down() is intentionally a no-op: the Brief entity, its columns, and the status
 * enum no longer exist in the codebase, so the table cannot be faithfully
 * recreated here. Restore from a database backup if the data is ever needed.
 */
export class DropBriefsTable1782400000000 implements MigrationInterface {
  name = 'DropBriefsTable1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "briefs"`);
  }

  public async down(): Promise<void> {
    // No-op — see class comment. The briefs module was deleted; the table cannot
    // be faithfully recreated. Restore from a backup if required.
  }
}
