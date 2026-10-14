-- Add ad creative fields to Advertisement
ALTER TABLE "Advertisement" ADD COLUMN "creativeFileName" TEXT;
ALTER TABLE "Advertisement" ADD COLUMN "creativeMimeType" TEXT;
ALTER TABLE "Advertisement" ADD COLUMN "creativeSize" INTEGER;
ALTER TABLE "Advertisement" ADD COLUMN "creativeOriginalName" TEXT;

CREATE UNIQUE INDEX "Advertisement_creativeFileName_key" ON "Advertisement"("creativeFileName");
