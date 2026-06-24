import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Page-scoped impact annotations: "Pin event" can now attach a pin to a single
 * page (pageId NOT NULL) instead of only the whole site (pageId NULL). Page pins
 * render only on that page's timeline and mark the page in the Impact pages list.
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddImpactAnnotationPageId1782600000000 implements MigrationInterface {
  name = 'AddImpactAnnotationPageId1782600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "impact_annotations" ADD COLUMN IF NOT EXISTS "pageId" uuid`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_impact_annotations_site_page" ON "impact_annotations" ("siteId", "pageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_impact_annotations_site_page"`);
    await queryRunner.query(`ALTER TABLE "impact_annotations" DROP COLUMN IF EXISTS "pageId"`);
  }
}
