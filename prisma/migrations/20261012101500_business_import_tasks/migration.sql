CREATE TYPE "BusinessImportTaskStatus" AS ENUM (
    'RUNNING',
    'SUCCEEDED',
    'FAILED',
    'STOPPED'
);

CREATE TABLE "BusinessImportTask" (
    "id" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "zipCode" TEXT NOT NULL,
    "categories" TEXT[] NOT NULL,
    "newBusinessLimit" INTEGER NOT NULL,
    "status" "BusinessImportTaskStatus" NOT NULL DEFAULT 'RUNNING',
    "message" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdByUserId" TEXT NOT NULL,

    CONSTRAINT "BusinessImportTask_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "Business"
ADD COLUMN "importTaskId" TEXT;

CREATE INDEX "Business_importTaskId_idx" ON "Business"("importTaskId");
CREATE INDEX "BusinessImportTask_startedAt_idx" ON "BusinessImportTask"("startedAt");
CREATE INDEX "BusinessImportTask_status_startedAt_idx"
ON "BusinessImportTask"("status", "startedAt");

ALTER TABLE "BusinessImportTask"
ADD CONSTRAINT "BusinessImportTask_createdByUserId_fkey"
FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Business"
ADD CONSTRAINT "Business_importTaskId_fkey"
FOREIGN KEY ("importTaskId") REFERENCES "BusinessImportTask"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
