import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Image ALT module — Phase 1 (data foundation).
 * Creates the placement-level image model that replaces the lossy, alt-keyed
 * per-page image counter:
 *   - `site_images`     : one row per canonical image (deduped across variants
 *                         & pages) carrying the CMS-managed ALT change-state.
 *   - `image_placements`: one row per <img> occurrence on a page, with the
 *                         observed alt + surrounding context for AI grounding.
 *
 * PRODUCTION migration (synchronize:false). Dev uses synchronize:true.
 */
export class AddSiteImagesAndPlacements1782500000000 implements MigrationInterface {
  name = 'AddSiteImagesAndPlacements1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "image_alt_status_enum" AS ENUM ('synced','ai_suggested','modified','removed');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "image_alt_source_enum" AS ENUM ('original','ai_generated','human');
      EXCEPTION WHEN duplicate_object THEN null; END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "site_images" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "canonicalKey" character varying(2048) NOT NULL,
        "canonicalUrl" character varying(2048) NOT NULL,
        "wpAttachmentId" bigint,
        "draftAlt" text,
        "observedAlt" text,
        "observedQuality" character varying(20) NOT NULL DEFAULT 'absent',
        "status" "image_alt_status_enum" NOT NULL DEFAULT 'synced',
        "source" "image_alt_source_enum" NOT NULL DEFAULT 'original',
        "decorative" boolean NOT NULL DEFAULT false,
        "aiRationale" text,
        "evidence" jsonb NOT NULL DEFAULT '[]',
        "unverifiedClaims" jsonb NOT NULL DEFAULT '[]',
        "needsReview" boolean NOT NULL DEFAULT false,
        "lastPublishedAt" TIMESTAMP,
        "publishError" text,
        "lastSeenAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_site_images" PRIMARY KEY ("id"),
        CONSTRAINT "uq_site_image_key" UNIQUE ("siteId","canonicalKey"),
        CONSTRAINT "FK_site_images_site" FOREIGN KEY ("siteId")
          REFERENCES "sites"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_site_images_siteId" ON "site_images" ("siteId")`,
    );

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "image_placements" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "siteId" uuid NOT NULL,
        "imageId" uuid NOT NULL,
        "pageId" uuid NOT NULL,
        "canonicalKey" character varying(2048) NOT NULL,
        "rawSrc" character varying(2048) NOT NULL,
        "domIndex" integer NOT NULL DEFAULT 0,
        "observedAlt" text,
        "quality" character varying(20) NOT NULL DEFAULT 'absent',
        "nearestHeading" text,
        "caption" text,
        "surroundingText" text,
        "firstSeenAt" TIMESTAMP,
        "lastSeenAt" TIMESTAMP,
        "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
        "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_image_placements" PRIMARY KEY ("id"),
        CONSTRAINT "uq_placement" UNIQUE ("pageId","canonicalKey","domIndex"),
        CONSTRAINT "FK_image_placements_image" FOREIGN KEY ("imageId")
          REFERENCES "site_images"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_image_placements_page" FOREIGN KEY ("pageId")
          REFERENCES "pages"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_image_placements_site" FOREIGN KEY ("siteId")
          REFERENCES "sites"("id") ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_image_placements_imageId" ON "image_placements" ("imageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_image_placements_pageId" ON "image_placements" ("pageId")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_image_placements_siteId" ON "image_placements" ("siteId")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "image_placements"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "site_images"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "image_alt_source_enum"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "image_alt_status_enum"`);
  }
}
