ALTER TABLE "ZipCode"
    ADD COLUMN "boundaryGeometry" JSONB,
    ADD COLUMN "centroidLatitude" DOUBLE PRECISION,
    ADD COLUMN "centroidLongitude" DOUBLE PRECISION,
    ADD COLUMN "boundaryVintage" INTEGER;
