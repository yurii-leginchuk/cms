import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Technical SEO Site Audit — Phase 1 (run engine + P0 regression detectors).
 *
 *  - audit_runs          — lineage: one row per site per run, with the
 *                          per-detector coverage ledger, detector versions,
 *                          live-fetch budget accounting and scope signature.
 *  - audit_findings      — mutable current state, one row per stable finding
 *                          (unique (siteId, fingerprint)); resolution is gated
 *                          on `resolutionBasis='verified_absent'`.
 *  - audit_observations  — append-only per-(fingerprint, run) ledger of the
 *                          verbatim raw signal each detector consumed (plus
 *                          the site-scope snapshots that carry robots.txt /
 *                          sitemap / HTTPS baselines between runs).
 *  - audit_site_settings — per-site kill switch + live-fetch budget.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. All DDL
 * is IF NOT EXISTS so it's safe to re-run.
 */
export class AddAuditModule1799000000000 implements MigrationInterface {
  name = 'AddAuditModule1799000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── audit_runs ───────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "trigger" character varying(16) NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'running',
        "startedAt" timestamptz NOT NULL DEFAULT now(),
        "finishedAt" timestamptz,
        "detectorVersions" jsonb,
        "coverage" jsonb,
        "scopeSignature" character varying(64),
        "liveFetchesUsed" integer NOT NULL DEFAULT 0,
        "liveFetchBudget" integer NOT NULL DEFAULT 0,
        "summary" jsonb,
        "errorBreakdown" jsonb,
        "fatalError" text,
        CONSTRAINT "PK_audit_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_runs_site" ON "audit_runs" ("siteId", "startedAt")`,
    );

    // ── audit_findings ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_findings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "fingerprint" char(64) NOT NULL,
        "checkType" character varying(40) NOT NULL,
        "severity" character varying(12) NOT NULL,
        "status" character varying(12) NOT NULL DEFAULT 'open',
        "subjectKey" character varying(2048) NOT NULL,
        "title" text NOT NULL,
        "evidence" jsonb,
        "affectedUrls" jsonb NOT NULL DEFAULT '[]',
        "firstSeenAt" timestamptz,
        "lastObservedAt" timestamptz,
        "lastEvaluatedAt" timestamptz,
        "lastEvaluatedRunId" uuid,
        "resolvedAt" timestamptz,
        "resolutionBasis" character varying(24),
        "regressionCount" integer NOT NULL DEFAULT 0,
        "detectorVersion" integer NOT NULL DEFAULT 0,
        "aiAnalysis" jsonb,
        "muteReason" text,
        "mutedAt" timestamptz,
        "mutedBy" character varying(255),
        "muteSnapshot" jsonb,
        "asanaTaskGid" character varying(64),
        "fixRoute" character varying(512),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_findings" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_audit_findings_fp" ON "audit_findings" ("siteId", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_findings_site_status" ON "audit_findings" ("siteId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_findings_site_check" ON "audit_findings" ("siteId", "checkType")`,
    );

    // ── audit_observations ───────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_observations" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "runId" uuid NOT NULL,
        "fingerprint" char(64) NOT NULL,
        "checkType" character varying(40) NOT NULL,
        "observedStatus" character varying(12) NOT NULL,
        "rawSignal" jsonb,
        "detectorVersion" integer NOT NULL DEFAULT 0,
        "observedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_observations" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_observations_fp" ON "audit_observations" ("siteId", "fingerprint", "observedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_observations_run" ON "audit_observations" ("runId")`,
    );

    // ── audit_site_settings ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "audit_site_settings" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "enabled" boolean NOT NULL DEFAULT true,
        "liveFetchBudget" integer NOT NULL DEFAULT 50,
        "aiAnalysisEnabled" boolean NOT NULL DEFAULT true,
        "muteDefaults" jsonb,
        "notifyEmail" character varying(255),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_audit_site_settings" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_audit_site_settings_site" ON "audit_site_settings" ("siteId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_site_settings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_observations"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_findings"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "audit_runs"`);
  }
}
