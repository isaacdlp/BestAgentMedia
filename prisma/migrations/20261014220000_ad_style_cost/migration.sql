-- Ad style name and cost, stored on the ad when it is priced (see promotionPackageId).

-- AlterTable
ALTER TABLE "Advertisement" ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "styleName" TEXT;


-- Backfill ads that already have a style.
UPDATE "Advertisement" AS ad
SET "styleName" = pkg."name",
    "costCents" = pkg."priceCents" * (
      SELECT COUNT(*)::INTEGER
      FROM "AdvertisementIssue" ai
      JOIN "Issue" i ON i."id" = ai."issueId"
      WHERE ai."advertisementId" = ad."id" AND i."publicationId" = pkg."publicationId"
    )
FROM "PromotionPackage" pkg
WHERE ad."promotionPackageId" = pkg."id";
