import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * "Purge cache everywhere" — per-site WP Engine flag.
 *
 * Adds `hostedOnWpEngine` to `sites`. Gates the WP Engine cache-purge layer so
 * the CMS only asks the plugin to run a WP Engine purge on sites that actually
 * live there (otherwise that layer is reported as "skipped", never "failed").
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddSiteHostedOnWpEngine1789000000000
  implements MigrationInterface
{
  name = 'AddSiteHostedOnWpEngine1789000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" ADD COLUMN IF NOT EXISTS "hostedOnWpEngine" boolean NOT NULL DEFAULT false`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "sites" DROP COLUMN IF EXISTS "hostedOnWpEngine"`,
    );
  }
}
