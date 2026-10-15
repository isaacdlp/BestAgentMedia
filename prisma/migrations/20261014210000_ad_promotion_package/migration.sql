-- Ad style: the promotion rate (size) chosen when an ad is created, which sets its cost per issue.

-- AlterTable
ALTER TABLE "Advertisement" ADD COLUMN     "promotionPackageId" INTEGER;

-- AddForeignKey
ALTER TABLE "Advertisement" ADD CONSTRAINT "Advertisement_promotionPackageId_fkey" FOREIGN KEY ("promotionPackageId") REFERENCES "PromotionPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

