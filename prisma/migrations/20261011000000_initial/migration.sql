CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PUBLISHER', 'CONTRIBUTOR', 'ADVERTISER');
CREATE TYPE "SubmissionStatus" AS ENUM ('NEW', 'IN_REVIEW', 'NEEDS_INFORMATION', 'ACCEPTED', 'DECLINED');
CREATE TYPE "AdvertisementStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'IN_REVIEW', 'APPROVED', 'PUBLISHED', 'DECLINED');

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Publication" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "city" TEXT,
    "state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Publication_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PublicationPublisher" (
    "userId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PublicationPublisher_pkey" PRIMARY KEY ("userId", "publicationId")
);

CREATE TABLE "ContentSubmission" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "submitterName" TEXT,
    "submitterEmail" TEXT,
    "body" TEXT NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'NEW',
    "publicationId" TEXT NOT NULL,
    "submittedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ContentSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Business" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Business_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Advertisement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "AdvertisementStatus" NOT NULL DEFAULT 'DRAFT',
    "businessId" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Advertisement_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");
CREATE UNIQUE INDEX "Publication_slug_key" ON "Publication"("slug");
CREATE INDEX "PublicationPublisher_publicationId_idx" ON "PublicationPublisher"("publicationId");
CREATE INDEX "ContentSubmission_publicationId_status_idx" ON "ContentSubmission"("publicationId", "status");
CREATE INDEX "ContentSubmission_submittedByUserId_createdAt_idx" ON "ContentSubmission"("submittedByUserId", "createdAt");
CREATE UNIQUE INDEX "Business_ownerUserId_key" ON "Business"("ownerUserId");
CREATE INDEX "Advertisement_publicationId_status_idx" ON "Advertisement"("publicationId", "status");
CREATE INDEX "Advertisement_businessId_createdAt_idx" ON "Advertisement"("businessId", "createdAt");

ALTER TABLE "PublicationPublisher" ADD CONSTRAINT "PublicationPublisher_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PublicationPublisher" ADD CONSTRAINT "PublicationPublisher_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentSubmission" ADD CONSTRAINT "ContentSubmission_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContentSubmission" ADD CONSTRAINT "ContentSubmission_submittedByUserId_fkey" FOREIGN KEY ("submittedByUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Business" ADD CONSTRAINT "Business_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Advertisement" ADD CONSTRAINT "Advertisement_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "Business"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Advertisement" ADD CONSTRAINT "Advertisement_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "Publication"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
