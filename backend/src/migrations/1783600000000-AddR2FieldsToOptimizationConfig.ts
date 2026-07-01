import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image Optimization — Phase 2, R2 upload credentials + upload facts.
 *
 * Adds R2 credential/bucket/verification columns to site_optimization_config
 * (secrets are AES-256-GCM encrypted at rest by the app) and r2Key/r2Uploaded
 * to image_optimization. Phase-3 rewrite/DNS fields are intentionally NOT here.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddR2FieldsToOptimizationConfig1783600000000
  implements MigrationInterface
{
  name = 'AddR2FieldsToOptimizationConfig1783600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "r2_status_enum" AS ENUM ('untested','verified','failed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      ALTER TABLE "site_optimization_config"
        ADD COLUMN IF NOT EXISTS "r2AccountId" character varying(64),
        ADD COLUMN IF NOT EXISTS "r2AccessKeyId" character varying(128),
        ADD COLUMN IF NOT EXISTS "r2SecretEnc" text,
        ADD COLUMN IF NOT EXISTS "cfApiTokenEnc" text,
        ADD COLUMN IF NOT EXISTS "r2Bucket" character varying(63),
        ADD COLUMN IF NOT EXISTS "r2Status" "r2_status_enum" NOT NULL DEFAULT 'untested',
        ADD COLUMN IF NOT EXISTS "r2VerifiedAt" TIMESTAMP,
        ADD COLUMN IF NOT EXISTS "r2LastError" character varying(255)
    `);

    await queryRunner.query(`
      ALTER TABLE "image_optimization"
        ADD COLUMN IF NOT EXISTS "r2Key" character varying(512),
        ADD COLUMN IF NOT EXISTS "r2Uploaded" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "image_optimization"
        DROP COLUMN IF EXISTS "r2Uploaded",
        DROP COLUMN IF EXISTS "r2Key"
    `);
    await queryRunner.query(`
      ALTER TABLE "site_optimization_config"
        DROP COLUMN IF EXISTS "r2LastError",
        DROP COLUMN IF EXISTS "r2VerifiedAt",
        DROP COLUMN IF EXISTS "r2Status",
        DROP COLUMN IF EXISTS "r2Bucket",
        DROP COLUMN IF EXISTS "cfApiTokenEnc",
        DROP COLUMN IF EXISTS "r2SecretEnc",
        DROP COLUMN IF EXISTS "r2AccessKeyId",
        DROP COLUMN IF EXISTS "r2AccountId"
    `);
    await queryRunner.query(`DROP TYPE IF EXISTS "r2_status_enum"`);
  }
}
