-- AlterTable
ALTER TABLE "AgentTask" ADD COLUMN "subjectType" TEXT,
ADD COLUMN "subjectId" TEXT;

-- CreateIndex
CREATE INDEX "AgentTask_subjectType_subjectId_idx" ON "AgentTask"("subjectType", "subjectId");
