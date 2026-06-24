import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Watched keywords (Impact keyword monitoring, Phase 3): a bounded, user-chosen
 * set of target queries to track over time — site-wide (pageId NULL) or scoped to
 * one page. Read-time monitoring; no per-day storage in this phase.
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddWatchedKeywords1782800000000 implements MigrationInterface {
  name = 'AddWatchedKeywords1782800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "watched_keywords" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "pageId" uuid,
        "pageUrl" character varying(2048),
        "query" character varying(255) NOT NULL,
        "normalizedQuery" character varying(255) NOT NULL,
        "source" character varying(16) NOT NULL DEFAULT 'manual',
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_watched_keywords" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_watched_keywords_site_page" ON "watched_keywords" ("siteId", "pageId")`,
    );
    // Dedup within a (site, page) scope. NULL pageId rows don't collide in a
    // Postgres unique index, so the service also de-dups site-wide rows in code.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_watched_keywords_scope_query" ON "watched_keywords" ("siteId", "pageId", "normalizedQuery")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_watched_keywords_scope_query"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_watched_keywords_site_page"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "watched_keywords"`);
  }
}
