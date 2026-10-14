-- AlterTable
ALTER TABLE "Publication" ADD COLUMN "description" TEXT;

-- AlterTable: add nullable columns first so existing issues can be backfilled
ALTER TABLE "Issue" ADD COLUMN "name" TEXT,
ADD COLUMN "slug" TEXT,
ADD COLUMN "description" TEXT;

-- Backfill "<Publication> <Season> <Year>" and its slug; a sequence suffix keeps slugs unique per publication.
WITH named AS (
  SELECT
    i."id",
    i."publicationId",
    p."name" || ' ' ||
      CASE
        WHEN EXTRACT(MONTH FROM i."publicationDate") IN (12, 1, 2) THEN 'Winter'
        WHEN EXTRACT(MONTH FROM i."publicationDate") IN (3, 4, 5) THEN 'Spring'
        WHEN EXTRACT(MONTH FROM i."publicationDate") IN (6, 7, 8) THEN 'Summer'
        ELSE 'Fall'
      END || ' ' || EXTRACT(YEAR FROM i."publicationDate")::int AS issue_name,
    ROW_NUMBER() OVER (
      PARTITION BY i."publicationId",
        EXTRACT(YEAR FROM i."publicationDate"),
        CASE
          WHEN EXTRACT(MONTH FROM i."publicationDate") IN (12, 1, 2) THEN 1
          WHEN EXTRACT(MONTH FROM i."publicationDate") IN (3, 4, 5) THEN 2
          WHEN EXTRACT(MONTH FROM i."publicationDate") IN (6, 7, 8) THEN 3
          ELSE 4
        END
      ORDER BY i."publicationDate", i."id"
    ) AS seq
  FROM "Issue" i
  JOIN "Publication" p ON p."id" = i."publicationId"
)
UPDATE "Issue" AS target
SET
  "name" = named.issue_name,
  "slug" = trim(both '-' from regexp_replace(lower(named.issue_name), '[^a-z0-9]+', '-', 'g'))
    || CASE WHEN named.seq > 1 THEN '-' || named.seq ELSE '' END
FROM named
WHERE target."id" = named."id";

ALTER TABLE "Issue" ALTER COLUMN "name" SET NOT NULL,
ALTER COLUMN "slug" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Issue_publicationId_slug_key" ON "Issue"("publicationId", "slug");
