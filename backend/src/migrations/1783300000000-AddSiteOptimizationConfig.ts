import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image Optimization — Phase 1, per-site config.
 *
 * PHASE 1 columns only (enabled/webpEnabled/quality/maxWidth). Phase 2 will ADD
 * the R2/Cloudflare credential columns (encrypted at rest) via a later migration.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddSiteOptimizationConfig1783300000000
  implements MigrationInterface
{
  name = 'AddSiteOptimizationConfig1783300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "site_optimization_config" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "webpEnabled" boolean NOT NULL DEFAULT true,
        "quality" integer NOT NULL DEFAULT 80,
        "maxWidth" integer DEFAULT 1600,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_site_optimization_config" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_site_optimization_config_site" ON "site_optimization_config" ("siteId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "site_optimization_config"
      ADD CONSTRAINT "fk_site_optimization_config_site"
      FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "site_optimization_config" DROP CONSTRAINT IF EXISTS "fk_site_optimization_config_site"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_site_optimization_config_site"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "site_optimization_config"`);
  }
}
