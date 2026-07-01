import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optimization Impact — ALT publish markers (Phase 1). Append-only record of each
 * ALT-text publish, freezing the immutable instant + the alt that went live + the
 * page-set at that time (so a later republish never relocates the earlier marker).
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true so the table
 * auto-creates from the entity. Reversible: down() drops it.
 */
export class AddAltPublishEvent1786000000000 implements MigrationInterface {
  name = 'AddAltPublishEvent1786000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "alt_publish_events" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "imageId" uuid NOT NULL,
        "canonicalUrl" character varying(2048) NOT NULL,
        "publishedAt" TIMESTAMP WITH TIME ZONE NOT NULL,
        "altAfter" text NOT NULL,
        "pageIds" jsonb NOT NULL DEFAULT '[]',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_alt_publish_events" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_alt_publish_site_time" ON "alt_publish_events" ("siteId", "publishedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_alt_publish_image" ON "alt_publish_events" ("imageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_alt_publish_image"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_alt_publish_site_time"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "alt_publish_events"`);
  }
}
