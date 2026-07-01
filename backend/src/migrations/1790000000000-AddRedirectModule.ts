import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Redirect management — Phase 1 (read-only mirror of the Redirection plugin).
 *
 * Creates the three tables that clone the Crawl/Index module's shape:
 *   - redirect_sync_runs  — lineage, one row per nightly/on-demand sync.
 *   - redirect_items      — mutable current-state projection (dual clocks,
 *                           plugin id + content fingerprint, tombstones).
 *   - redirect_snapshots  — append-only change ledger with raw payload verbatim.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. All DDL is
 * IF NOT EXISTS so it's safe to re-run.
 */
export class AddRedirectModule1790000000000 implements MigrationInterface {
  name = 'AddRedirectModule1790000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── redirect_sync_runs ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redirect_sync_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "trigger" character varying(16) NOT NULL,
        "startedAt" timestamptz NOT NULL DEFAULT now(),
        "finishedAt" timestamptz,
        "apiVersion" character varying(64),
        "mappingVersion" integer NOT NULL DEFAULT 0,
        "detectionVersion" integer NOT NULL DEFAULT 0,
        "redirectionActive" boolean,
        "pluginVersion" character varying(32),
        "wholeSetHash" char(64),
        "unchanged" boolean NOT NULL DEFAULT false,
        "redirectsFetched" integer NOT NULL DEFAULT 0,
        "groupsFetched" integer NOT NULL DEFAULT 0,
        "added" integer NOT NULL DEFAULT 0,
        "updated" integer NOT NULL DEFAULT 0,
        "deleted" integer NOT NULL DEFAULT 0,
        "unchangedCount" integer NOT NULL DEFAULT 0,
        "errored" integer NOT NULL DEFAULT 0,
        "fatalError" text,
        CONSTRAINT "PK_redirect_sync_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_sync_runs_site" ON "redirect_sync_runs" ("siteId", "startedAt")`,
    );

    // ── redirect_items ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redirect_items" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "pluginId" integer,
        "fingerprint" char(64) NOT NULL,
        "source" text NOT NULL,
        "sourceNormalized" text NOT NULL,
        "target" text,
        "targetNormalized" text,
        "matchType" character varying(32),
        "actionType" character varying(32),
        "actionCode" integer,
        "regex" boolean NOT NULL DEFAULT false,
        "groupId" integer,
        "groupName" text,
        "position" integer NOT NULL DEFAULT 0,
        "enabled" boolean NOT NULL DEFAULT true,
        "title" text,
        "wpLastAccess" timestamptz,
        "wpLastCount" integer NOT NULL DEFAULT 0,
        "driftState" character varying(16) NOT NULL DEFAULT 'in_sync',
        "deletedInWpAt" timestamptz,
        "lastSyncedAt" timestamptz,
        "firstSeenAt" timestamptz,
        "lastRunId" uuid,
        "rawPayload" jsonb,
        "mappingVersion" integer NOT NULL DEFAULT 0,
        "detectionVersion" integer NOT NULL DEFAULT 0,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_redirect_items" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_redirect_items_plugin" ON "redirect_items" ("siteId", "pluginId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_items_site_fp" ON "redirect_items" ("siteId", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_items_site_drift" ON "redirect_items" ("siteId", "driftState")`,
    );

    // ── redirect_snapshots ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redirect_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "runId" uuid,
        "pluginId" integer,
        "fingerprint" char(64) NOT NULL,
        "prevFingerprint" char(64),
        "changeKind" character varying(16) NOT NULL,
        "observedAt" timestamptz NOT NULL DEFAULT now(),
        "source" text NOT NULL,
        "target" text,
        "actionCode" integer,
        "enabled" boolean NOT NULL DEFAULT true,
        "rawPayload" jsonb,
        "mappingVersion" integer NOT NULL DEFAULT 0,
        "detectionVersion" integer NOT NULL DEFAULT 0,
        "apiVersion" character varying(64),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_redirect_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_snapshots_item" ON "redirect_snapshots" ("siteId", "pluginId", "observedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_snapshots_run" ON "redirect_snapshots" ("runId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redirect_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redirect_items"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redirect_sync_runs"`);
  }
}
