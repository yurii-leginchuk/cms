import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `pages.missingFromSitemapAt` — a sitemap tombstone. Pages that disappear
 * from the sitemap were previously kept forever as live inventory: they burned
 * URL-Inspection quota in the crawl rotation and padded every per-site list.
 * The row is kept (history/metrics stay), only rotation/work skips it.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. IF NOT
 * EXISTS so it's safe to re-run.
 */
export class AddPageSitemapTombstone1797000000000 implements MigrationInterface {
  name = 'AddPageSitemapTombstone1797000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" ADD COLUMN IF NOT EXISTS "missingFromSitemapAt" TIMESTAMP`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "pages" DROP COLUMN IF EXISTS "missingFromSitemapAt"`,
    );
  }
}
