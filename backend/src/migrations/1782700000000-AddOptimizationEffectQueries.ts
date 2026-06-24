import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-query before→after snapshots for optimization effects (Impact keyword
 * drill-down, Phase 1). One row per (effect, window, query); a remainder row
 * reconciles disclosed queries to the page total (anonymized-query gap).
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddOptimizationEffectQueries1782700000000 implements MigrationInterface {
  name = 'AddOptimizationEffectQueries1782700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "optimization_effect_queries" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "effectId" uuid NOT NULL,
        "window" character varying(8) NOT NULL,
        "query" character varying(255) NOT NULL,
        "clicks" integer NOT NULL DEFAULT 0,
        "impressions" integer NOT NULL DEFAULT 0,
        "ctr" real NOT NULL DEFAULT 0,
        "position" real NOT NULL DEFAULT 0,
        "isRemainder" boolean NOT NULL DEFAULT false,
        CONSTRAINT "PK_optimization_effect_queries" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_oeq_effect_window" ON "optimization_effect_queries" ("effectId", "window")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_oeq_effect_window"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "optimization_effect_queries"`);
  }
}
