-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'CONTRIBUTOR';

-- CreateTable
CREATE TABLE "BusinessClaimToken" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "businessId" INTEGER NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessClaimToken_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessClaimToken_token_key" ON "BusinessClaimToken"("token");

-- CreateIndex
CREATE INDEX "BusinessClaimToken_businessId_idx" ON "BusinessClaimToken"("businessId");

-- AddForeignKey
ALTER TABLE "BusinessClaimToken" ADD CONSTRAINT "BusinessClaimToken_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
