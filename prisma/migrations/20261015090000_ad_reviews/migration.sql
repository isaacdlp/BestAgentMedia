-- Advertiser reviews of ads (public review page and email), plus Marketer instructions and the review link token on promotion deals.

-- CreateEnum
CREATE TYPE "AdReviewDecision" AS ENUM ('APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "AdReviewSource" AS ENUM ('REVIEW_PAGE', 'EMAIL');

-- AlterTable
ALTER TABLE "PromotionDeal" ADD COLUMN     "instructions" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "reviewToken" TEXT;

-- CreateTable
CREATE TABLE "AdReview" (
    "id" SERIAL NOT NULL,
    "advertisementId" TEXT NOT NULL,
    "promotionDealId" INTEGER,
    "source" "AdReviewSource" NOT NULL,
    "decision" "AdReviewDecision" NOT NULL,
    "comments" TEXT NOT NULL DEFAULT '',
    "reviewerName" TEXT,
    "creativeFileName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdReview_advertisementId_createdAt_idx" ON "AdReview"("advertisementId", "createdAt");

-- CreateIndex
CREATE INDEX "AdReview_promotionDealId_idx" ON "AdReview"("promotionDealId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionDeal_reviewToken_key" ON "PromotionDeal"("reviewToken");

-- AddForeignKey
ALTER TABLE "AdReview" ADD CONSTRAINT "AdReview_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AdReview" ADD CONSTRAINT "AdReview_promotionDealId_fkey" FOREIGN KEY ("promotionDealId") REFERENCES "PromotionDeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

