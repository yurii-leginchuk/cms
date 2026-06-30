import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Meta editor — full per-page meta support (robots tri-state, nofollow, Open Graph).
 *  - pages.indexDirective: Yoast robots tri-state (default|index|noindex),
 *    backfilled from the legacy boolean `noindex` (true → noindex, else default).
 *    The boolean column is KEPT and mirrored for the agent/chat/embedding code.
 *  - pages.nofollow: robots nofollow override (false = follow).
 *  - pages.ogTitle / ogDescription / ogImage / ogImageId: Open Graph overrides.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddPageOgAndRobotsFields1783000000000
  implements MigrationInterface
{
  name = 'AddPageOgAndRobotsFields1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "pages_indexdirective_enum" AS ENUM ('default', 'index', 'noindex');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "indexDirective" "pages_indexdirective_enum" NOT NULL DEFAULT 'default'`,
    );
    // Backfill from the legacy boolean: an explicit true becomes NOINDEX; a
    // false stays DEFAULT (we do NOT pin pages to explicit '2'/index).
    await queryRunner.query(
      `UPDATE "pages" SET "indexDirective" = 'noindex' WHERE "noindex" = true`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "nofollow" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "ogTitle" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "ogDescription" text`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "ogImage" character varying(2048)`,
    );
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "ogImageId" bigint`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "pages" DROP COLUMN IF EXISTS "ogImageId"`);
    await queryRunner.query(`ALTER TABLE "pages" DROP COLUMN IF EXISTS "ogImage"`);
    await queryRunner.query(`ALTER TABLE "pages" DROP COLUMN IF EXISTS "ogDescription"`);
    await queryRunner.query(`ALTER TABLE "pages" DROP COLUMN IF EXISTS "ogTitle"`);
    await queryRunner.query(`ALTER TABLE "pages" DROP COLUMN IF EXISTS "nofollow"`);
    await queryRunner.query(`ALTER TABLE "pages" DROP COLUMN IF EXISTS "indexDirective"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "pages_indexdirective_enum"`);
  }
}
