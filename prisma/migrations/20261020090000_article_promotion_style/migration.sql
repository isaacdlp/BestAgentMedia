-- Paid promotion style and cost of an article (see Article.promotionPackageId).

-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "costCents" INTEGER,
ADD COLUMN     "promotionPackageId" INTEGER,
ADD COLUMN     "styleName" TEXT;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_promotionPackageId_fkey" FOREIGN KEY ("promotionPackageId") REFERENCES "PromotionPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;
