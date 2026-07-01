import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image Optimization — Phase 1, current-state projection (1:1 companion to
 * site_images). Byte columns are bigint (int8) so a large library can't
 * overflow. Phase 2 will ADD r2Key/r2Uploaded/rewriteLive/rewriteVerifiedAt.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddImageOptimization1783400000000 implements MigrationInterface {
  name = 'AddImageOptimization1783400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "image_optimization_state_enum" AS ENUM
          ('not_optimized','queued','optimizing','optimized','skipped','failed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "image_optimization" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "imageId" uuid NOT NULL,
        "siteId" uuid NOT NULL,
        "state" "image_optimization_state_enum" NOT NULL DEFAULT 'not_optimized',
        "originalBytes" bigint,
        "optimizedBytes" bigint,
        "outputFormat" character varying(16),
        "outputWidth" integer,
        "outputHeight" integer,
        "sourceHash" character varying(64),
        "settingsFingerprint" character varying(64),
        "skipReason" character varying(20),
        "failurePhase" character varying(10),
        "failureError" text,
        "sourceFetchedAt" TIMESTAMP,
        "optimizedAt" TIMESTAMP,
        "lastRunId" uuid,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_image_optimization" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "uq_image_optimization_image" ON "image_optimization" ("imageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_image_optimization_site" ON "image_optimization" ("siteId")`,
    );
    await queryRunner.query(`
      ALTER TABLE "image_optimization"
      ADD CONSTRAINT "fk_image_optimization_image"
      FOREIGN KEY ("imageId") REFERENCES "site_images"("id") ON DELETE CASCADE
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE IF EXISTS "image_optimization" DROP CONSTRAINT IF EXISTS "fk_image_optimization_image"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_image_optimization_site"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "uq_image_optimization_image"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "image_optimization"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "image_optimization_state_enum"`);
  }
}
