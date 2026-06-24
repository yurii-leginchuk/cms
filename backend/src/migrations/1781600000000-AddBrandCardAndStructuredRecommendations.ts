import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * AI grounding work:
 *  - creates the `brand_cards` table (structured site ground truth / offering allow-list)
 *  - migrates briefs.recommendations from text → jsonb (structured arguments, Proposal 9)
 *  - adds briefs.unverifiedClaims (jsonb) for the faithfulness "confirm or remove" banner
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 *
 * The recommendations text→jsonb conversion wraps any legacy free-text value in a
 * single structured recommendation so existing rows survive the type change.
 */
export class AddBrandCardAndStructuredRecommendations1781600000000
  implements MigrationInterface
{
  name = 'AddBrandCardAndStructuredRecommendations1781600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // ── brand_cards ──────────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "brand_cards" (
        "siteId" uuid PRIMARY KEY,
        "brandName" varchar(200),
        "spelling" varchar(80),
        "services" jsonb NOT NULL DEFAULT '[]',
        "locations" jsonb NOT NULL DEFAULT '[]',
        "people" jsonb NOT NULL DEFAULT '[]',
        "certifications" jsonb NOT NULL DEFAULT '[]',
        "approvedClaims" jsonb NOT NULL DEFAULT '[]',
        "neverSay" jsonb NOT NULL DEFAULT '[]',
        "ctas" jsonb NOT NULL DEFAULT '[]',
        "reviewed" boolean NOT NULL DEFAULT false,
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now()
      )
    `);

    // ── briefs.unverifiedClaims + sectionSources ────────────────────────────
    await queryRunner.query(
      `ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "unverifiedClaims" jsonb`,
    );
    await queryRunner.query(
      `ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "sectionSources" jsonb`,
    );

    // ── briefs.recommendations: text → jsonb (wrap legacy text) ─────────────
    await queryRunner.query(`ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "recommendations_jsonb" jsonb`);
    await queryRunner.query(`
      UPDATE "briefs"
      SET "recommendations_jsonb" = json_build_array(
        json_build_object(
          'evidence', json_build_object('metric', '(legacy)', 'source', 'onpage', 'dateRange', NULL),
          'reasoning', "recommendations",
          'action', json_build_object('type', 'content', 'targetUrl', "pageUrl", 'anchorText', NULL, 'sourcePage', NULL),
          'expectedImpact', json_build_object('estimate', NULL, 'label', 'directional_not_calculated')
        )
      )::jsonb
      WHERE "recommendations" IS NOT NULL AND length(trim("recommendations")) > 0
    `);
    await queryRunner.query(`ALTER TABLE "briefs" DROP COLUMN "recommendations"`);
    await queryRunner.query(`ALTER TABLE "briefs" RENAME COLUMN "recommendations_jsonb" TO "recommendations"`);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // recommendations jsonb → text (best-effort: stringify the JSON)
    await queryRunner.query(`ALTER TABLE "briefs" ADD COLUMN IF NOT EXISTS "recommendations_text" text`);
    await queryRunner.query(
      `UPDATE "briefs" SET "recommendations_text" = "recommendations"::text WHERE "recommendations" IS NOT NULL`,
    );
    await queryRunner.query(`ALTER TABLE "briefs" DROP COLUMN "recommendations"`);
    await queryRunner.query(`ALTER TABLE "briefs" RENAME COLUMN "recommendations_text" TO "recommendations"`);

    await queryRunner.query(`ALTER TABLE "briefs" DROP COLUMN IF EXISTS "sectionSources"`);
    await queryRunner.query(`ALTER TABLE "briefs" DROP COLUMN IF EXISTS "unverifiedClaims"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "brand_cards"`);
  }
}
