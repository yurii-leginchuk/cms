import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optimization Impact — manual-annotation UX upgrade (Phase 4). Adds optional
 * `type` (event kind for the subtype + presets) and `link` (reference URL) to
 * impact_annotations. Reversible.
 */
export class AddAnnotationTypeLink1787000000000 implements MigrationInterface {
  name = 'AddAnnotationTypeLink1787000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impact_annotations" ADD COLUMN IF NOT EXISTS "type" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "impact_annotations" ADD COLUMN IF NOT EXISTS "link" character varying(1024)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "impact_annotations" DROP COLUMN IF EXISTS "link"`);
    await queryRunner.query(`ALTER TABLE "impact_annotations" DROP COLUMN IF EXISTS "type"`);
  }
}
