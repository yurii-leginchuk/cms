import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Redirect management — Phase 4 (first-sync audit queue + severity enrichment).
 *
 *  - redirect_issues     — derived, deduped, ranked issues (survey-only; writes
 *                          still flow through the Phase-2 gate).
 *  - redirect_audit_runs — audit lineage (counts by type/severity + GSC/GA4 context).
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. All DDL is
 * IF NOT EXISTS so it's safe to re-run.
 */
export class AddRedirectAudit1793000000000 implements MigrationInterface {
  name = 'AddRedirectAudit1793000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── redirect_issues ──────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redirect_issues" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "issueType" character varying(40) NOT NULL,
        "severity" character varying(12) NOT NULL,
        "fixMode" character varying(12) NOT NULL,
        "rank" bigint NOT NULL DEFAULT 0,
        "fingerprint" char(64) NOT NULL,
        "primaryRedirectId" uuid,
        "redirectIds" jsonb NOT NULL DEFAULT '[]',
        "title" text NOT NULL,
        "detail" text,
        "evidence" jsonb,
        "proposedFix" jsonb,
        "status" character varying(12) NOT NULL DEFAULT 'open',
        "detectionVersion" integer NOT NULL DEFAULT 0,
        "lastRunId" uuid,
        "firstSeenAt" timestamptz,
        "resolvedAt" timestamptz,
        "deferredAt" timestamptz,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_redirect_issues" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_redirect_issues_fp" ON "redirect_issues" ("siteId", "fingerprint")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_issues_site_status" ON "redirect_issues" ("siteId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_issues_site_rank" ON "redirect_issues" ("siteId", "rank")`,
    );

    // ── redirect_audit_runs ──────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "redirect_audit_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "trigger" character varying(16) NOT NULL,
        "startedAt" timestamptz NOT NULL DEFAULT now(),
        "finishedAt" timestamptz,
        "detectionVersion" integer NOT NULL DEFAULT 0,
        "redirectsAnalyzed" integer NOT NULL DEFAULT 0,
        "issuesOpen" integer NOT NULL DEFAULT 0,
        "issuesResolved" integer NOT NULL DEFAULT 0,
        "byType" jsonb,
        "bySeverity" jsonb,
        "gscConnected" boolean NOT NULL DEFAULT false,
        "ga4Connected" boolean NOT NULL DEFAULT false,
        "ga4OrganicRevenue" double precision,
        "fatalError" text,
        CONSTRAINT "PK_redirect_audit_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_redirect_audit_runs_site" ON "redirect_audit_runs" ("siteId", "startedAt")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "redirect_audit_runs"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "redirect_issues"`);
  }
}
