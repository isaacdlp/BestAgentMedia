CREATE TABLE "SubmissionImage" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SubmissionImage_fileName_key" ON "SubmissionImage"("fileName");
CREATE INDEX "SubmissionImage_submissionId_createdAt_idx" ON "SubmissionImage"("submissionId", "createdAt");

ALTER TABLE "SubmissionImage"
ADD CONSTRAINT "SubmissionImage_submissionId_fkey"
FOREIGN KEY ("submissionId") REFERENCES "ContentSubmission"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
