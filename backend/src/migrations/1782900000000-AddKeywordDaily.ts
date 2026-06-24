import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persisted daily series for watched keywords (Impact keyword monitoring, Phase
 * 3.5). Bounded by the user-chosen watched set; zero-filled per day like
 * gsc_daily so history is reproducible beyond GSC's 16-month window.
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddKeywordDaily1782900000000 implements MigrationInterface {
  name = 'AddKeywordDaily1782900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "keyword_daily" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "watchedKeywordId" uuid NOT NULL,
        "siteId" uuid NOT NULL,
        "date" date NOT NULL,
        "clicks" integer NOT NULL DEFAULT 0,
        "impressions" integer NOT NULL DEFAULT 0,
        "position" real NOT NULL DEFAULT 0,
        "fetchedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_keyword_daily" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_keyword_daily_kw_date" ON "keyword_daily" ("watchedKeywordId", "date")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_keyword_daily_kw_date"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "keyword_daily"`);
  }
}
