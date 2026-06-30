import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates `mcp_change_requests` — the staging table for the human-approval gate.
 * MCP-originated edits land here as PENDING proposals until a human accepts
 * (apply + publish) or rejects them.
 *
 * NOTE: PRODUCTION migration (synchronize:false). Dev uses synchronize:true and
 * creates this table directly from the entity.
 */
export class AddMcpChangeRequests1783200000000 implements MigrationInterface {
  name = 'AddMcpChangeRequests1783200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "mcp_change_requests" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "module" character varying(16) NOT NULL,
        "action" character varying(32) NOT NULL,
        "targetType" character varying(16) NOT NULL,
        "targetId" character varying(64) NOT NULL,
        "targetLabel" text,
        "payload" jsonb NOT NULL,
        "before" jsonb,
        "summary" text NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "origin" character varying(16) NOT NULL DEFAULT 'mcp',
        "error" text,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "decidedAt" TIMESTAMP,
        CONSTRAINT "PK_mcp_change_requests" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "IDX_mcp_changes_siteId_status" ON "mcp_change_requests" ("siteId", "status")`,
    );
    await queryRunner.query(
      `CREATE INDEX "IDX_mcp_changes_siteId_module_status" ON "mcp_change_requests" ("siteId", "module", "status")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mcp_changes_siteId_module_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_mcp_changes_siteId_status"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "mcp_change_requests"`);
  }
}
