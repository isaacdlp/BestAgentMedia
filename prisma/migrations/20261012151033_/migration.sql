/*
  Warnings:

  - Made the column `publicationId` on table `Advertisement` required. This step will fail if there are existing NULL values in that column.
  - Made the column `publicationId` on table `ContentSubmission` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "Advertisement" ALTER COLUMN "publicationId" SET NOT NULL;

-- AlterTable
ALTER TABLE "ContentSubmission" ALTER COLUMN "publicationId" SET NOT NULL;
