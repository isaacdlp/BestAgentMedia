-- CreateEnum
CREATE TYPE "PromotionSaleStatus" AS ENUM ('PROPOSED', 'NEGOTIATING', 'PURCHASED', 'DECLINED');

-- CreateTable
CREATE TABLE "PromotionSale" (
    "id" SERIAL NOT NULL,
    "agentTaskId" TEXT NOT NULL,
    "businessId" INTEGER NOT NULL,
    "issueId" TEXT,
    "publicationId" INTEGER NOT NULL,
    "subAgentId" INTEGER,
    "threadId" TEXT,
    "instructions" TEXT NOT NULL DEFAULT '',
    "status" "PromotionSaleStatus" NOT NULL DEFAULT 'PROPOSED',
    "proposal" JSONB,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "followUpSentAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "purchasedAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionSaleItem" (
    "id" SERIAL NOT NULL,
    "saleId" INTEGER NOT NULL,
    "kind" "PromotionPackageKind" NOT NULL,
    "packageId" INTEGER,
    "packageName" TEXT NOT NULL,
    "issueId" TEXT,
    "listPriceCents" INTEGER NOT NULL,
    "discountPercent" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL,
    "advertisementId" TEXT,
    "articleId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromotionSaleItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromotionSale_agentTaskId_key" ON "PromotionSale"("agentTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionSale_threadId_key" ON "PromotionSale"("threadId");

-- CreateIndex
CREATE INDEX "PromotionSale_businessId_createdAt_idx" ON "PromotionSale"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionSale_issueId_createdAt_idx" ON "PromotionSale"("issueId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionSale_status_createdAt_idx" ON "PromotionSale"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionSaleItem_advertisementId_key" ON "PromotionSaleItem"("advertisementId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionSaleItem_articleId_key" ON "PromotionSaleItem"("articleId");

-- CreateIndex
CREATE INDEX "PromotionSaleItem_saleId_idx" ON "PromotionSaleItem"("saleId");

-- CreateIndex
CREATE INDEX "PromotionSaleItem_issueId_idx" ON "PromotionSaleItem"("issueId");

-- AddForeignKey
ALTER TABLE "PromotionSale" ADD CONSTRAINT "PromotionSale_agentTaskId_fkey" FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSale" ADD CONSTRAINT "PromotionSale_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSale" ADD CONSTRAINT "PromotionSale_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSale" ADD CONSTRAINT "PromotionSale_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSale" ADD CONSTRAINT "PromotionSale_subAgentId_fkey" FOREIGN KEY ("subAgentId") REFERENCES "SubAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSale" ADD CONSTRAINT "PromotionSale_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSale" ADD CONSTRAINT "PromotionSale_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSaleItem" ADD CONSTRAINT "PromotionSaleItem_saleId_fkey" FOREIGN KEY ("saleId") REFERENCES "PromotionSale"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSaleItem" ADD CONSTRAINT "PromotionSaleItem_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PromotionPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSaleItem" ADD CONSTRAINT "PromotionSaleItem_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSaleItem" ADD CONSTRAINT "PromotionSaleItem_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionSaleItem" ADD CONSTRAINT "PromotionSaleItem_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE SET NULL ON UPDATE CASCADE;

