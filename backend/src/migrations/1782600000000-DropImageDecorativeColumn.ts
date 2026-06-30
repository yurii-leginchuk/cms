import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Drops `site_images.decorative`. The "decorative" concept was removed — every
 * image must carry a real alt description, so there is no deliberate-empty state.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true and drops
 * the column automatically once the entity field is gone.
 *
 * down() re-adds the column (default false) so the schema can be restored, but
 * the prior per-image decorative flags are not recoverable.
 */
export class DropImageDecorativeColumn1782600000000 implements MigrationInterface {
  name = 'DropImageDecorativeColumn1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "site_images" DROP COLUMN IF EXISTS "decorative"`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "site_images" ADD COLUMN IF NOT EXISTS "decorative" boolean NOT NULL DEFAULT false`,
    );
  }
}
