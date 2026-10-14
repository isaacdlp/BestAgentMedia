-- Add description and cta columns to Advertisement
ALTER TABLE "Advertisement" ADD COLUMN "description" TEXT;
ALTER TABLE "Advertisement" ADD COLUMN "cta" TEXT;

-- Create AdvertisementPublication join table
CREATE TABLE "AdvertisementPublication" (
    "advertisementId" TEXT NOT NULL,
    "publicationId" INTEGER NOT NULL,
    CONSTRAINT "AdvertisementPublication_pkey" PRIMARY KEY ("advertisementId","publicationId")
);

-- Migrate existing publicationId data into AdvertisementPublication
INSERT INTO "AdvertisementPublication" ("advertisementId", "publicationId")
SELECT "id", "publicationId" FROM "Advertisement";

-- Drop old publicationId and its index/FK from Advertisement
DROP INDEX IF EXISTS "Advertisement_publicationId_status_idx";
ALTER TABLE "Advertisement" DROP COLUMN "publicationId";

-- Update status index to match new schema
CREATE INDEX "Advertisement_status_updatedAt_idx" ON "Advertisement"("status", "updatedAt");

-- Add foreign keys for AdvertisementPublication
ALTER TABLE "AdvertisementPublication"
    ADD CONSTRAINT "AdvertisementPublication_advertisementId_fkey"
    FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "AdvertisementPublication"
    ADD CONSTRAINT "AdvertisementPublication_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "AdvertisementPublication_publicationId_idx" ON "AdvertisementPublication"("publicationId");

-- Create AdImage table
CREATE TABLE "AdImage" (
    "id" TEXT NOT NULL,
    "advertisementId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AdImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdImage_fileName_key" ON "AdImage"("fileName");
CREATE INDEX "AdImage_advertisementId_position_idx" ON "AdImage"("advertisementId", "position");

ALTER TABLE "AdImage"
    ADD CONSTRAINT "AdImage_advertisementId_fkey"
    FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Create BusinessImage table
CREATE TABLE "BusinessImage" (
    "id" TEXT NOT NULL,
    "businessId" INTEGER NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BusinessImage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BusinessImage_fileName_key" ON "BusinessImage"("fileName");
CREATE INDEX "BusinessImage_businessId_position_idx" ON "BusinessImage"("businessId", "position");

ALTER TABLE "BusinessImage"
    ADD CONSTRAINT "BusinessImage_businessId_fkey"
    FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE CASCADE ON UPDATE CASCADE;
