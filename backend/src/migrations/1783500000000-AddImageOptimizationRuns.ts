import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image Optimization — Phase 1, append-only run history. Per-run byte sums are
 * scoped to the run (never site totals). bigint sums so a bulk run over a large
 * library can't overflow int4.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddImageOptimizationRuns1783500000000
  implements MigrationInterface
{
  name = 'AddImageOptimizationRuns1783500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "image_optimization_run_scope_enum" AS ENUM ('all','new_only','force_all');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "image_optimization_run_trigger_enum" AS ENUM ('manual','nightly');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "image_optimization_run_status_enum" AS ENUM ('running','done','cancelled','error');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "image_optimization_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "startedAt" TIMESTAMP NOT NULL DEFAULT now(),
        "finishedAt" TIMESTAMP,
        "triggeredBy" "image_optimization_run_trigger_enum" NOT NULL DEFAULT 'manual',
        "scope" "image_optimization_run_scope_enum" NOT NULL,
        "settingsSnapshot" jsonb NOT NULL DEFAULT '{}',
        "settingsFingerprint" character varying(64),
        "imagesConsidered" integer NOT NULL DEFAULT 0,
        "processed" integer NOT NULL DEFAULT 0,
        "optimized" integer NOT NULL DEFAULT 0,
        "skipped" integer NOT NULL DEFAULT 0,
        "failed" integer NOT NULL DEFAULT 0,
        "originalBytesSum" bigint NOT NULL DEFAULT 0,
        "optimizedBytesSum" bigint NOT NULL DEFAULT 0,
        "bytesSavedSum" bigint NOT NULL DEFAULT 0,
        "status" "image_optimization_run_status_enum" NOT NULL DEFAULT 'running',
        "error" text,
        CONSTRAINT "pk_image_optimization_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "idx_image_optimization_runs_site" ON "image_optimization_runs" ("siteId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_image_optimization_runs_site"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "image_optimization_runs"`);
    await queryRunner.query(
      `DROP TYPE IF EXISTS "image_optimization_run_status_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "image_optimization_run_trigger_enum"`,
    );
    await queryRunner.query(
      `DROP TYPE IF EXISTS "image_optimization_run_scope_enum"`,
    );
  }
}
