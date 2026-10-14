-- CreateTable
CREATE TABLE "HereCategory" (
    "id" SERIAL NOT NULL,
    "hereId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HereCategory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "HereCategory_hereId_key" ON "HereCategory"("hereId");

-- CreateIndex
CREATE INDEX "HereCategory_name_idx" ON "HereCategory"("name");
