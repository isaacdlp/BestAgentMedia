-- AlterTable
ALTER TABLE "Article" ADD COLUMN     "businessId" INTEGER;

-- AlterTable
ALTER TABLE "ContentSubmission" ADD COLUMN     "businessId" INTEGER;

-- CreateIndex
CREATE INDEX "Article_businessId_idx" ON "Article"("businessId");

-- CreateIndex
CREATE INDEX "ContentSubmission_businessId_idx" ON "ContentSubmission"("businessId");

-- AddForeignKey
ALTER TABLE "ContentSubmission" ADD CONSTRAINT "ContentSubmission_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Article" ADD CONSTRAINT "Article_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE SET NULL ON UPDATE CASCADE;
