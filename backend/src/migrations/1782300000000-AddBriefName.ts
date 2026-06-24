import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the briefs.name column — a user-supplied custom title for a brief.
 * Nullable; the UI falls back to the meta title / page URL when null.
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddBriefName1782300000000 implements MigrationInterface {
  name = 'AddBriefName1782300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "name" character varying(255)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "briefs" DROP COLUMN IF EXISTS "name"`,
    );
  }
}
