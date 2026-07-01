import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Asana Integration — Phase 1. Three tables:
 *  - asana_connection   : single global row (encrypted PAT + workspace + status)
 *  - asana_project_map  : per-site → project mapping (+ webhook state, sync freshness)
 *  - asana_task         : the local task mirror (one row per tracked Asana task)
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true so these
 * tables auto-create from the entities. Reversible: down() drops all three.
 */
export class AddAsanaIntegration1785000000000 implements MigrationInterface {
  name = 'AddAsanaIntegration1785000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── asana_connection ────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "asana_connection" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "patEnc" text,
        "workspaceGid" character varying(64),
        "workspaceName" character varying(255),
        "userGid" character varying(64),
        "userName" character varying(255),
        "status" character varying(16) NOT NULL DEFAULT 'untested',
        "verifiedAt" TIMESTAMP,
        "lastError" character varying(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_asana_connection" PRIMARY KEY ("id")
      )
    `);

    // ── asana_project_map ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "asana_project_map" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "projectGid" character varying(64),
        "projectName" character varying(255),
        "webhookGid" character varying(64),
        "webhookSecretEnc" text,
        "webhookStatus" character varying(16) NOT NULL DEFAULT 'none',
        "webhookLastReceivedAt" TIMESTAMP,
        "lastFullSyncAt" TIMESTAMP,
        "syncError" character varying(255),
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_asana_project_map" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_asana_project_map_site" ON "asana_project_map" ("siteId")`,
    );
    await queryRunner.query(
      `ALTER TABLE "asana_project_map" ADD CONSTRAINT "fk_asana_project_map_site" FOREIGN KEY ("siteId") REFERENCES "sites"("id") ON DELETE CASCADE`,
    );

    // ── asana_task ──────────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "asana_task" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "projectGid" character varying(64) NOT NULL,
        "taskGid" character varying(64) NOT NULL,
        "name" text NOT NULL,
        "notes" text,
        "assigneeGid" character varying(64),
        "assigneeName" character varying(255),
        "sectionGid" character varying(64),
        "sectionName" character varying(255),
        "completed" boolean NOT NULL DEFAULT false,
        "dueOn" date,
        "permalinkUrl" character varying(512),
        "parentTaskGid" character varying(64),
        "numSubtasks" integer NOT NULL DEFAULT 0,
        "raw" jsonb,
        "linkedEntityType" character varying(32),
        "linkedEntityId" character varying(128),
        "origin" character varying(16) NOT NULL DEFAULT 'asana',
        "asanaModifiedAt" TIMESTAMP,
        "lastEventAt" TIMESTAMP,
        "lastSyncedAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_asana_task" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_asana_task_gid" ON "asana_task" ("taskGid")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_asana_task_site" ON "asana_task" ("siteId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_asana_task_site_completed" ON "asana_task" ("siteId", "completed")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_asana_task_site_section" ON "asana_task" ("siteId", "sectionGid")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_asana_task_linked" ON "asana_task" ("linkedEntityType", "linkedEntityId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_asana_task_linked"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_asana_task_site_section"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_asana_task_site_completed"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_asana_task_site"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_asana_task_gid"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "asana_task"`);
    await queryRunner.query(
      `ALTER TABLE "asana_project_map" DROP CONSTRAINT IF EXISTS "fk_asana_project_map_site"`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_asana_project_map_site"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "asana_project_map"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "asana_connection"`);
  }
}
