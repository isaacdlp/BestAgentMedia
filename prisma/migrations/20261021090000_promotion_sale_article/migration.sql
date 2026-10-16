-- Promote on an article page: the sale that sells this article to its business as a paid sponsored feature.

-- AlterTable
ALTER TABLE "PromotionSale" ADD COLUMN     "articleId" TEXT;

-- CreateIndex
CREATE INDEX "PromotionSale_articleId_idx" ON "PromotionSale"("articleId");

-- AddForeignKey
ALTER TABLE "PromotionSale" ADD CONSTRAINT "PromotionSale_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;
