import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optimization Impact timeline foundation:
 *  1. brand_cards.brandTerms — branded/non-branded GSC split for the impact charts.
 *  2. gsc_daily — persisted daily Search Console series (per site, global or per
 *     page) powering the DevTools-style performance timeline. Stored so long
 *     date ranges and exports stay stable beyond GSC's 16-month window and the
 *     24h query cache.
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddBrandTermsAndGscDaily1782400000000 implements MigrationInterface {
  name = 'AddBrandTermsAndGscDaily1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "brand_cards" ADD COLUMN IF NOT EXISTS "brandTerms" jsonb NOT NULL DEFAULT '[]'`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "gsc_daily" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "scope" character varying(8) NOT NULL DEFAULT 'global',
        "pageUrl" character varying(2048),
        "date" date NOT NULL,
        "clicks" integer NOT NULL DEFAULT 0,
        "impressions" integer NOT NULL DEFAULT 0,
        "position" real NOT NULL DEFAULT 0,
        "nbClicks" integer NOT NULL DEFAULT 0,
        "nbImpressions" integer NOT NULL DEFAULT 0,
        "nbPosition" real NOT NULL DEFAULT 0,
        "hasBrandSplit" boolean NOT NULL DEFAULT false,
        "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_gsc_daily" PRIMARY KEY ("id")
      )
    `);
    // One row per (site, scope, page, day). pageUrl is '' for global so the unique
    // index is well-defined (NULLs don't collide in a unique index in Postgres).
    await queryRunner.query(
      `ALTER TABLE "gsc_daily" ALTER COLUMN "pageUrl" SET DEFAULT ''`,
    );
    await queryRunner.query(
      `UPDATE "gsc_daily" SET "pageUrl" = '' WHERE "pageUrl" IS NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_gsc_daily_scope" ON "gsc_daily" ("siteId", "scope", "pageUrl", "date")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_gsc_daily_site_date" ON "gsc_daily" ("siteId", "date")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "impact_annotations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "date" date NOT NULL,
        "label" character varying(200) NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_impact_annotations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_impact_annotations_site_date" ON "impact_annotations" ("siteId", "date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "impact_annotations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "gsc_daily"`);
    await queryRunner.query(
      `ALTER TABLE "brand_cards" DROP COLUMN IF EXISTS "brandTerms"`,
    );
  }
}
