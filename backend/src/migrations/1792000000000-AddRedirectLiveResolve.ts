import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Redirect management — Phase 3 (validation engine + live HTTP resolve).
 *
 * Adds the live-resolve cache to `redirect_items`: the last real HTTP trail for a
 * redirect (final status/url, hop count, the trail json, and when it was checked)
 * so the list can flag redirect→404/loop and re-runs are cheap. The graph/cycle/
 * chain analysis is pure (computed in code) and needs no schema.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. All DDL is
 * IF NOT EXISTS so it's safe to re-run.
 */
export class AddRedirectLiveResolve1792000000000 implements MigrationInterface {
  name = 'AddRedirectLiveResolve1792000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redirect_items" ADD COLUMN IF NOT EXISTS "liveFinalStatus" integer`);
    await queryRunner.query(`ALTER TABLE "redirect_items" ADD COLUMN IF NOT EXISTS "liveFinalUrl" text`);
    await queryRunner.query(`ALTER TABLE "redirect_items" ADD COLUMN IF NOT EXISTS "liveHops" integer`);
    await queryRunner.query(`ALTER TABLE "redirect_items" ADD COLUMN IF NOT EXISTS "liveTrail" jsonb`);
    await queryRunner.query(`ALTER TABLE "redirect_items" ADD COLUMN IF NOT EXISTS "liveCheckedAt" timestamptz`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "redirect_items" DROP COLUMN IF EXISTS "liveCheckedAt"`);
    await queryRunner.query(`ALTER TABLE "redirect_items" DROP COLUMN IF EXISTS "liveTrail"`);
    await queryRunner.query(`ALTER TABLE "redirect_items" DROP COLUMN IF EXISTS "liveHops"`);
    await queryRunner.query(`ALTER TABLE "redirect_items" DROP COLUMN IF EXISTS "liveFinalUrl"`);
    await queryRunner.query(`ALTER TABLE "redirect_items" DROP COLUMN IF EXISTS "liveFinalStatus"`);
  }
}
