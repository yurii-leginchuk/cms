import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Google Index Inspection — Phase 1. Four tables:
 *  - crawl_page_status  : mutable one-row-per-URL current state (fast reads)
 *  - crawl_inspections  : append-only ledger, one row per state change (raw kept)
 *  - crawl_scan_runs    : lineage, one row per scan run
 *  - crawl_quota_ledger : atomic daily quota cap (per property, Pacific day)
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true so these
 * tables auto-create from the entities. Reversible: down() drops all four.
 */
export class AddCrawlIndexInspection1784000000000 implements MigrationInterface {
  name = 'AddCrawlIndexInspection1784000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── crawl_page_status ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crawl_page_status" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "pageId" uuid,
        "url" character varying(2048) NOT NULL,
        "derivedStatus" character varying(40),
        "isIndexed" boolean,
        "coverageStateRaw" text,
        "verdict" character varying(40),
        "indexingState" character varying(40),
        "robotsTxtState" character varying(40),
        "pageFetchState" character varying(40),
        "crawledAs" character varying(40),
        "googleCanonical" character varying(2048),
        "userCanonical" character varying(2048),
        "canonicalConflict" boolean NOT NULL DEFAULT false,
        "googleLastCrawlTime" timestamptz,
        "lastInspectedAt" timestamptz,
        "firstSeenAt" timestamptz,
        "stateHash" character(64),
        "mappingVersion" integer NOT NULL DEFAULT 0,
        "apiVersion" character varying(64),
        "lastRunId" uuid,
        "lastError" text,
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        "updatedAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_crawl_page_status" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crawl_page_status_url" ON "crawl_page_status" ("siteId", "url")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crawl_page_status_site_status" ON "crawl_page_status" ("siteId", "derivedStatus")`,
    );

    // ── crawl_inspections ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crawl_inspections" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "pageId" uuid,
        "url" character varying(2048) NOT NULL,
        "runId" uuid,
        "observedAt" timestamptz NOT NULL DEFAULT now(),
        "rawPayload" jsonb,
        "derivedStatus" character varying(40),
        "prevDerivedStatus" character varying(40),
        "isIndexed" boolean,
        "coverageStateRaw" text,
        "verdict" character varying(40),
        "indexingState" character varying(40),
        "robotsTxtState" character varying(40),
        "pageFetchState" character varying(40),
        "crawledAs" character varying(40),
        "googleCanonical" character varying(2048),
        "userCanonical" character varying(2048),
        "canonicalConflict" boolean NOT NULL DEFAULT false,
        "googleLastCrawlTime" timestamptz,
        "stateHash" character(64),
        "prevStateHash" character(64),
        "isDeindexation" boolean NOT NULL DEFAULT false,
        "isFirstSeen" boolean NOT NULL DEFAULT false,
        "mappingVersion" integer NOT NULL DEFAULT 0,
        "apiVersion" character varying(64),
        "createdAt" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_crawl_inspections" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crawl_inspections_url_time" ON "crawl_inspections" ("siteId", "url", "observedAt")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crawl_inspections_run" ON "crawl_inspections" ("runId")`,
    );

    // ── crawl_scan_runs ───────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crawl_scan_runs" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "trigger" character varying(16) NOT NULL,
        "property" character varying(512),
        "propertyType" character varying(16),
        "startedAt" timestamptz NOT NULL DEFAULT now(),
        "finishedAt" timestamptz,
        "apiVersion" character varying(64),
        "mappingVersion" integer NOT NULL DEFAULT 0,
        "quotaBudget" integer NOT NULL DEFAULT 0,
        "pagesSelected" integer NOT NULL DEFAULT 0,
        "pagesInspected" integer NOT NULL DEFAULT 0,
        "pagesChanged" integer NOT NULL DEFAULT 0,
        "pagesSkippedQuota" integer NOT NULL DEFAULT 0,
        "pagesErrored" integer NOT NULL DEFAULT 0,
        "errorBreakdown" jsonb,
        "selectionStrategy" character varying(64),
        "fatalError" text,
        CONSTRAINT "pk_crawl_scan_runs" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_crawl_scan_runs_site" ON "crawl_scan_runs" ("siteId", "startedAt")`,
    );

    // ── crawl_quota_ledger ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "crawl_quota_ledger" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid,
        "property" character varying(512) NOT NULL,
        "quotaDate" date NOT NULL,
        "used" integer NOT NULL DEFAULT 0,
        "capDaily" integer NOT NULL DEFAULT 2000,
        "budgetNightly" integer NOT NULL DEFAULT 1500,
        CONSTRAINT "pk_crawl_quota_ledger" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_crawl_quota_property_date" ON "crawl_quota_ledger" ("property", "quotaDate")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_crawl_quota_property_date"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crawl_quota_ledger"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_crawl_scan_runs_site"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crawl_scan_runs"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_crawl_inspections_run"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_crawl_inspections_url_time"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crawl_inspections"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_crawl_page_status_site_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_crawl_page_status_url"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "crawl_page_status"`);
  }
}
