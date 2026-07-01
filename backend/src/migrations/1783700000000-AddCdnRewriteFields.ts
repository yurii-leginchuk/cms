import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image Optimization — Phase 3, CDN custom-domain + live URL-rewrite state.
 *
 * Adds the CDN domain / DNS status / rewrite kill-switch to
 * site_optimization_config, and the per-image live-serving facts (rewriteLive,
 * rewriteVerifiedAt) to image_optimization. Does NOT touch Phase 1/2 columns.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddCdnRewriteFields1783700000000 implements MigrationInterface {
  name = 'AddCdnRewriteFields1783700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "dns_status_enum" AS ENUM ('none','pending','active','error');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "site_optimization_config"
        ADD COLUMN IF NOT EXISTS "cdnDomain" character varying(255),
        ADD COLUMN IF NOT EXISTS "cfZoneId" character varying(64),
        ADD COLUMN IF NOT EXISTS "dnsStatus" "dns_status_enum" NOT NULL DEFAULT 'none',
        ADD COLUMN IF NOT EXISTS "dnsError" character varying(255),
        ADD COLUMN IF NOT EXISTS "rewriteEnabled" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      ALTER TABLE "image_optimization"
        ADD COLUMN IF NOT EXISTS "rewriteLive" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "rewriteVerifiedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "image_optimization"
        DROP COLUMN IF EXISTS "rewriteVerifiedAt",
        DROP COLUMN IF EXISTS "rewriteLive"
    `);
    await queryRunner.query(`
      ALTER TABLE "site_optimization_config"
        DROP COLUMN IF EXISTS "rewriteEnabled",
        DROP COLUMN IF EXISTS "dnsError",
        DROP COLUMN IF EXISTS "dnsStatus",
        DROP COLUMN IF EXISTS "cfZoneId",
        DROP COLUMN IF EXISTS "cdnDomain"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "dns_status_enum"`);
  }
}
