import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds `sites.ga4PropertyId/ga4PropertyName/ga4StreamUri` — the GA4 property
 * matched to the site's domain, persisted after the first successful discovery.
 * Previously every cold cache (10-min in-memory TTL, lost on restart) re-walked
 * the GA4 Admin API (accountSummaries + dataStreams per property), which
 * intermittently hit quota/timeouts and made the Impact page silently drop GA4.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true. IF NOT
 * EXISTS so it's safe to re-run.
 */
export class AddSiteGa4Property1798000000000 implements MigrationInterface {
  name = 'AddSiteGa4Property1798000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "ga4PropertyId" character varying(32)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "ga4PropertyName" character varying(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "ga4StreamUri" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "sites" DROP COLUMN IF EXISTS "ga4PropertyId"`);
    await queryRunner.query(`ALTER TABLE "sites" DROP COLUMN IF EXISTS "ga4PropertyName"`);
    await queryRunner.query(`ALTER TABLE "sites" DROP COLUMN IF EXISTS "ga4StreamUri"`);
  }
}
