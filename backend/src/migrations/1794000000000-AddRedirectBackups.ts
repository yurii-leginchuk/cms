import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Redirect management — Phase 5 (bulk import/export).
 *
 * Adds `redirect_backups` — a point-in-time lossless JSON snapshot of a site's
 * redirects, taken automatically before any bulk apply so an import is one-click
 * reversible (restore re-enqueues through the Phase-2 gate). Import diff + parsing
 * are pure (in code) and need no schema.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. IF NOT
 * EXISTS so it's safe to re-run.
 */
export class AddRedirectBackups1794000000000 implements MigrationInterface {
  name = 'AddRedirectBackups1794000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redirect_backups" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "reason" character varying(16) NOT NULL,
        "redirectCount" integer NOT NULL DEFAULT 0,
        "content" jsonb NOT NULL,
        "note" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_redirect_backups" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_backups_site" ON "redirect_backups" ("siteId", "createdAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redirect_backups"`);
  }
}
