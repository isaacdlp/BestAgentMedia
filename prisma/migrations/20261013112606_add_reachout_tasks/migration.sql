-- CreateEnum
CREATE TYPE "ReachoutTaskStatus" AS ENUM ('PENDING', 'RUNNING', 'SUCCEEDED', 'FAILED', 'STOPPED');

-- CreateTable
CREATE TABLE "ReachoutTask" (
    "id" TEXT NOT NULL,
    "status" "ReachoutTaskStatus" NOT NULL DEFAULT 'PENDING',
    "message" TEXT NOT NULL DEFAULT '',
    "autoTriggered" BOOLEAN NOT NULL DEFAULT false,
    "businessId" INTEGER NOT NULL,
    "subAgentId" INTEGER,
    "threadId" TEXT,
    "initialEmailSentAt" TIMESTAMP(3),
    "reminder1SentAt" TIMESTAMP(3),
    "reminder2SentAt" TIMESTAMP(3),
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReachoutTask_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ReachoutTask_threadId_key" ON "ReachoutTask"("threadId");

-- CreateIndex
CREATE INDEX "ReachoutTask_businessId_idx" ON "ReachoutTask"("businessId");

-- CreateIndex
CREATE INDEX "ReachoutTask_status_createdAt_idx" ON "ReachoutTask"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "ReachoutTask" ADD CONSTRAINT "ReachoutTask_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReachoutTask" ADD CONSTRAINT "ReachoutTask_subAgentId_fkey" FOREIGN KEY ("subAgentId") REFERENCES "SubAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReachoutTask" ADD CONSTRAINT "ReachoutTask_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "EmailThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReachoutTask" ADD CONSTRAINT "ReachoutTask_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
