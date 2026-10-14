-- AlterTable: track which AdImage is the source of the current creative
ALTER TABLE "Advertisement" ADD COLUMN "creativeImageId" TEXT;
