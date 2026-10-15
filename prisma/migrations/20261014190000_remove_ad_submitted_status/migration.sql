-- Remove the SUBMITTED stage; existing submitted ads move to IN_REVIEW.
UPDATE "Advertisement" SET "status" = 'IN_REVIEW' WHERE "status" = 'SUBMITTED';

ALTER TABLE "Advertisement" ALTER COLUMN "status" DROP DEFAULT;
ALTER TYPE "AdvertisementStatus" RENAME TO "AdvertisementStatus_old";
CREATE TYPE "AdvertisementStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DECLINED');
ALTER TABLE "Advertisement" ALTER COLUMN "status" TYPE "AdvertisementStatus" USING ("status"::text::"AdvertisementStatus");
ALTER TABLE "Advertisement" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
DROP TYPE "AdvertisementStatus_old";
