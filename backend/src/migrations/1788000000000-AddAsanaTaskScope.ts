import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Asana task → Optimization Impact (Phase 2). Adds:
 *  - asana_task.completedAt (Asana's completion clock — drives the impact marker)
 *  - asana_task.scope ('sitewide' | 'pages' | null)
 *  - asana_task_page : which pages a `pages`-scoped task is credited to.
 *
 * Dev uses synchronize:true (auto-creates); prod runs this. Reversible.
 */
export class AddAsanaTaskScope1788000000000 implements MigrationInterface {
  name = 'AddAsanaTaskScope1788000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "asana_task" ADD COLUMN IF NOT EXISTS "completedAt" TIMESTAMP`,
    );
    await queryRunner.query(
      `ALTER TABLE "asana_task" ADD COLUMN IF NOT EXISTS "scope" character varying(16)`,
    );
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "asana_task_page" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "taskGid" character varying(64) NOT NULL,
        "pageId" uuid NOT NULL,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "pk_asana_task_page" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_asana_task_page_task" ON "asana_task_page" ("taskGid")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_asana_task_page_site_page" ON "asana_task_page" ("siteId", "pageId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_asana_task_page_site_page"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_asana_task_page_task"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "asana_task_page"`);
    await queryRunner.query(`ALTER TABLE "asana_task" DROP COLUMN IF EXISTS "scope"`);
    await queryRunner.query(`ALTER TABLE "asana_task" DROP COLUMN IF EXISTS "completedAt"`);
  }
}
