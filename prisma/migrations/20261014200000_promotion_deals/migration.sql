-- Advertiser review and paid promotion deals run by the Marketer agent, and the per-publication
-- rate card (PromotionPackage) the Marketer sells from. See schema.prisma.

-- CreateEnum
CREATE TYPE "PromotionContentStatus" AS ENUM ('PENDING', 'APPROVED', 'CHANGES_REQUESTED');

-- CreateEnum
CREATE TYPE "PromotionDealStatus" AS ENUM ('PROPOSED', 'INTERESTED', 'SIGNED_UP', 'DECLINED');

-- CreateEnum
CREATE TYPE "PromotionPackageKind" AS ENUM ('AD', 'ARTICLE');

-- CreateTable
CREATE TABLE "PromotionPackage" (
    "id" SERIAL NOT NULL,
    "publicationId" INTEGER NOT NULL,
    "kind" "PromotionPackageKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionPackage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromotionDeal" (
    "id" SERIAL NOT NULL,
    "agentTaskId" TEXT NOT NULL,
    "businessId" INTEGER NOT NULL,
    "advertisementId" TEXT,
    "articleId" TEXT,
    "issueId" TEXT,
    "publicationId" INTEGER,
    "subAgentId" INTEGER,
    "threadId" TEXT,
    "contentStatus" "PromotionContentStatus" NOT NULL DEFAULT 'PENDING',
    "status" "PromotionDealStatus" NOT NULL DEFAULT 'PROPOSED',
    "requestedChanges" TEXT,
    "packageId" INTEGER,
    "packageName" TEXT,
    "priceCents" INTEGER,
    "optedOut" BOOLEAN NOT NULL DEFAULT false,
    "followUpSentAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "signedUpAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PromotionDeal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PromotionPackage_publicationId_kind_position_idx" ON "PromotionPackage"("publicationId", "kind", "position");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionDeal_agentTaskId_key" ON "PromotionDeal"("agentTaskId");

-- CreateIndex
CREATE UNIQUE INDEX "PromotionDeal_threadId_key" ON "PromotionDeal"("threadId");

-- CreateIndex
CREATE INDEX "PromotionDeal_businessId_createdAt_idx" ON "PromotionDeal"("businessId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionDeal_advertisementId_createdAt_idx" ON "PromotionDeal"("advertisementId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionDeal_articleId_createdAt_idx" ON "PromotionDeal"("articleId", "createdAt");

-- CreateIndex
CREATE INDEX "PromotionDeal_status_createdAt_idx" ON "PromotionDeal"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "PromotionPackage" ADD CONSTRAINT "PromotionPackage_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_agentTaskId_fkey" FOREIGN KEY ("agentTaskId") REFERENCES "AgentTask"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_advertisementId_fkey" FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_articleId_fkey" FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "PromotionPackage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_subAgentId_fkey" FOREIGN KEY ("subAgentId") REFERENCES "SubAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromotionDeal" ADD CONSTRAINT "PromotionDeal_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

