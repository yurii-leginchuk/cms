import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Redirect management — Phase 2 (gated writes + drift + push ledger).
 *
 *  - Adds `pendingChangeId` + `pendingBaselineFingerprint` to `redirect_items`
 *    (the three-way reconciliation markers).
 *  - Creates `redirect_pushes` — the CMS→WP write ledger (idempotent retry,
 *    mirroring `sync_jobs`).
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. All DDL is
 * IF NOT EXISTS so it's safe to re-run.
 */
export class AddRedirectWrites1791000000000 implements MigrationInterface {
  name = 'AddRedirectWrites1791000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── redirect_items: three-way reconciliation markers ─────────────────────
    await queryRunner.query(
      `ALTER TABLE "redirect_items" ADD COLUMN IF NOT EXISTS "pendingChangeId" uuid`,
    );
    await queryRunner.query(
      `ALTER TABLE "redirect_items" ADD COLUMN IF NOT EXISTS "pendingBaselineFingerprint" char(64)`,
    );

    // ── redirect_pushes: CMS→WP write ledger ─────────────────────────────────
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "redirect_pushes_status_enum" AS ENUM ('pending', 'processing', 'success', 'failed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redirect_pushes" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "changeRequestId" uuid NOT NULL,
        "redirectItemId" uuid,
        "pluginId" integer,
        "action" character varying(24) NOT NULL,
        "status" "redirect_pushes_status_enum" NOT NULL DEFAULT 'pending',
        "attempts" integer NOT NULL DEFAULT 0,
        "maxAttempts" integer NOT NULL DEFAULT 4,
        "nextRetryAt" timestamptz,
        "lastError" text,
        "verifyOk" boolean,
        "appliedAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_redirect_pushes" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "IDX_redirect_pushes_change" ON "redirect_pushes" ("changeRequestId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_pushes_retry" ON "redirect_pushes" ("status", "nextRetryAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redirect_pushes"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "redirect_pushes_status_enum"`);
    await queryRunner.query(
      `ALTER TABLE "redirect_items" DROP COLUMN IF EXISTS "pendingBaselineFingerprint"`,
    );
    await queryRunner.query(
      `ALTER TABLE "redirect_items" DROP COLUMN IF EXISTS "pendingChangeId"`,
    );
  }
}
