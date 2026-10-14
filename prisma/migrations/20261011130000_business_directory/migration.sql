ALTER TABLE "Business" ALTER COLUMN "ownerUserId" DROP NOT NULL;

ALTER TABLE "Business"
    ADD COLUMN "sourceProvider" TEXT NOT NULL DEFAULT 'MANUAL',
    ADD COLUMN "externalId" TEXT,
    ADD COLUMN "sourceQuery" TEXT,
    ADD COLUMN "primaryCategory" TEXT,
    ADD COLUMN "categories" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    ADD COLUMN "addressLabel" TEXT,
    ADD COLUMN "houseNumber" TEXT,
    ADD COLUMN "street" TEXT,
    ADD COLUMN "city" TEXT,
    ADD COLUMN "state" TEXT,
    ADD COLUMN "stateCode" TEXT,
    ADD COLUMN "postalCode" TEXT,
    ADD COLUMN "countryCode" TEXT,
    ADD COLUMN "latitude" DOUBLE PRECISION,
    ADD COLUMN "longitude" DOUBLE PRECISION,
    ADD COLUMN "distanceMeters" INTEGER,
    ADD COLUMN "phone" TEXT,
    ADD COLUMN "email" TEXT,
    ADD COLUMN "website" TEXT,
    ADD COLUMN "sourceRetrievedAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "Business_externalId_key" ON "Business"("externalId");
CREATE INDEX "Business_postalCode_idx" ON "Business"("postalCode");
CREATE INDEX "Business_city_stateCode_idx" ON "Business"("city", "stateCode");
CREATE INDEX "Business_sourceProvider_idx" ON "Business"("sourceProvider");

ALTER TABLE "Business" DROP CONSTRAINT "Business_ownerUserId_fkey";
ALTER TABLE "Business" ADD CONSTRAINT "Business_ownerUserId_fkey"
    FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
