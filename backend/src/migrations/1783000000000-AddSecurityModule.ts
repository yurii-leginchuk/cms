import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Security / cloaking-detection module, Phase 1. Four tables:
 *  - security_scan_runs      : lineage anchor per nightly scan pass
 *  - security_scan_snapshots : deduped normalized (page,axis) content
 *  - security_scan_findings  : immutable evidence ledger
 *  - security_incidents      : mutable triage workflow + suppression
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddSecurityModule1783000000000 implements MigrationInterface {
  name = 'AddSecurityModule1783000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_scan_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'running',
        "pagesTotal" integer NOT NULL DEFAULT 0,
        "pagesScanned" integer NOT NULL DEFAULT 0,
        "pagesUnreachable" integer NOT NULL DEFAULT 0,
        "findingsCount" integer NOT NULL DEFAULT 0,
        "startedAt" TIMESTAMP,
        "finishedAt" TIMESTAMP,
        "rubricVersion" integer NOT NULL DEFAULT 1,
        "normalizationVersion" integer NOT NULL DEFAULT 1,
        "lexiconVersion" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_scan_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_runs_site_created" ON "security_scan_runs" ("siteId", "createdAt")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_scan_snapshots" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "pageId" uuid NOT NULL,
        "axis" character varying(20) NOT NULL,
        "contentHash" character varying(64) NOT NULL,
        "normalizedContent" text NOT NULL,
        "externalScriptOrigins" jsonb NOT NULL DEFAULT '[]',
        "externalLinkDomains" jsonb NOT NULL DEFAULT '[]',
        "rawByteLength" integer NOT NULL DEFAULT 0,
        "normalizationVersion" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_scan_snapshots" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_snap_site_page_axis" ON "security_scan_snapshots" ("siteId", "pageId", "axis", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_security_snap_page_axis_hash" ON "security_scan_snapshots" ("pageId", "axis", "contentHash")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_scan_findings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "runId" uuid NOT NULL,
        "siteId" uuid NOT NULL,
        "pageId" uuid NOT NULL,
        "pageUrl" text NOT NULL,
        "dominantDetector" character varying(40) NOT NULL,
        "signals" jsonb NOT NULL DEFAULT '[]',
        "score" integer NOT NULL DEFAULT 0,
        "severity" character varying(20) NOT NULL,
        "axisAStatus" character varying(20) NOT NULL,
        "axisBStatus" character varying(20) NOT NULL,
        "axisAHttpStatus" integer,
        "axisBHttpStatus" integer,
        "redirectChainA" jsonb NOT NULL DEFAULT '[]',
        "redirectChainB" jsonb NOT NULL DEFAULT '[]',
        "snapshotAId" uuid,
        "snapshotBId" uuid,
        "excerpt" text,
        "incidentKey" character varying(64) NOT NULL,
        "scope" character varying(10) NOT NULL,
        "signature" character varying(255) NOT NULL,
        "rubricVersion" integer NOT NULL DEFAULT 1,
        "normalizationVersion" integer NOT NULL DEFAULT 1,
        "lexiconVersion" integer NOT NULL DEFAULT 1,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_scan_findings" PRIMARY KEY ("id"),
        CONSTRAINT "FK_security_findings_page" FOREIGN KEY ("pageId")
          REFERENCES "pages"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_find_site_created" ON "security_scan_findings" ("siteId", "createdAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_find_run" ON "security_scan_findings" ("runId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_find_key" ON "security_scan_findings" ("incidentKey")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "security_incidents" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "pageId" uuid,
        "incidentKey" character varying(64) NOT NULL,
        "scope" character varying(10) NOT NULL,
        "detector" character varying(40) NOT NULL,
        "severity" character varying(20) NOT NULL,
        "status" character varying(20) NOT NULL DEFAULT 'open',
        "title" text NOT NULL,
        "firstFindingId" uuid NOT NULL,
        "latestFindingId" uuid NOT NULL,
        "affectedPageCount" integer NOT NULL DEFAULT 1,
        "snoozedUntil" TIMESTAMP,
        "suppressedPattern" boolean NOT NULL DEFAULT false,
        "resolvedAt" TIMESTAMP,
        "lastSeenAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_security_incidents" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_inc_site_status" ON "security_incidents" ("siteId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_security_inc_key_status" ON "security_incidents" ("incidentKey", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "security_incidents"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_scan_findings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_scan_snapshots"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "security_scan_runs"`);
  }
}
