import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image Optimization — Phase 4, automation (nightly autopilot + new-upload webhook).
 *
 * Adds the encrypted webhook secret and the two automation toggles + last-received
 * timestamp to site_optimization_config. Does NOT touch Phase 1/2/3 columns.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddWebhookSecret1783800000000 implements MigrationInterface {
  name = 'AddWebhookSecret1783800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "site_optimization_config"
        ADD COLUMN IF NOT EXISTS "webhookSecretEnc" text,
        ADD COLUMN IF NOT EXISTS "autopilotEnabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "webhookEnabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "webhookLastReceivedAt" TIMESTAMP
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "site_optimization_config"
        DROP COLUMN IF EXISTS "webhookLastReceivedAt",
        DROP COLUMN IF EXISTS "webhookEnabled",
        DROP COLUMN IF EXISTS "autopilotEnabled",
        DROP COLUMN IF EXISTS "webhookSecretEnc"
    `);
  }
}
