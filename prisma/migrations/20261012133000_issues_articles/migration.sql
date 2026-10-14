CREATE TYPE "IssueStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'PUBLISHED');
CREATE TYPE "ArticleStatus" AS ENUM ('DRAFT', 'ACCEPTED', 'PUBLISHED');
CREATE TYPE "IssuePageType" AS ENUM ('COVER', 'INNER', 'BACK_COVER');

CREATE TABLE "Issue" (
    "id" TEXT NOT NULL,
    "publicationId" INTEGER NOT NULL,
    "publicationDate" DATE NOT NULL,
    "status" "IssueStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Issue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IssuePage" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "pageNumber" INTEGER NOT NULL,
    "type" "IssuePageType" NOT NULL,
    "designJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "IssuePage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Article" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" "ArticleStatus" NOT NULL DEFAULT 'DRAFT',
    "sourceSubmissionId" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Article_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ArticlePublication" (
    "articleId" TEXT NOT NULL,
    "publicationId" INTEGER NOT NULL,
    CONSTRAINT "ArticlePublication_pkey" PRIMARY KEY ("articleId", "publicationId")
);

CREATE TABLE "ArticleImage" (
    "id" TEXT NOT NULL,
    "articleId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "caption" TEXT NOT NULL DEFAULT '',
    "mimeType" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ArticleImage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "IssuePagePlacement" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "elementId" TEXT NOT NULL,
    "articleId" TEXT,
    "advertisementId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IssuePagePlacement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "IssuePagePlacement_exactly_one_item_check"
        CHECK (("articleId" IS NOT NULL AND "advertisementId" IS NULL) OR
               ("articleId" IS NULL AND "advertisementId" IS NOT NULL))
);

CREATE UNIQUE INDEX "Issue_publicationId_publicationDate_key"
    ON "Issue"("publicationId", "publicationDate");
CREATE INDEX "Issue_publicationId_status_publicationDate_idx"
    ON "Issue"("publicationId", "status", "publicationDate");
CREATE UNIQUE INDEX "IssuePage_issueId_pageNumber_key"
    ON "IssuePage"("issueId", "pageNumber");
CREATE INDEX "IssuePage_issueId_type_idx" ON "IssuePage"("issueId", "type");
CREATE UNIQUE INDEX "IssuePage_one_cover_per_issue_key"
    ON "IssuePage"("issueId") WHERE "type" = 'COVER';
CREATE UNIQUE INDEX "IssuePage_one_back_cover_per_issue_key"
    ON "IssuePage"("issueId") WHERE "type" = 'BACK_COVER';
CREATE UNIQUE INDEX "Article_sourceSubmissionId_key" ON "Article"("sourceSubmissionId");
CREATE INDEX "Article_status_updatedAt_idx" ON "Article"("status", "updatedAt");
CREATE INDEX "Article_createdByUserId_updatedAt_idx" ON "Article"("createdByUserId", "updatedAt");
CREATE INDEX "ArticlePublication_publicationId_idx" ON "ArticlePublication"("publicationId");
CREATE UNIQUE INDEX "ArticleImage_fileName_key" ON "ArticleImage"("fileName");
CREATE INDEX "ArticleImage_articleId_position_idx" ON "ArticleImage"("articleId", "position");
CREATE UNIQUE INDEX "IssuePagePlacement_pageId_elementId_key" ON "IssuePagePlacement"("pageId", "elementId");
CREATE INDEX "IssuePagePlacement_articleId_idx" ON "IssuePagePlacement"("articleId");
CREATE INDEX "IssuePagePlacement_advertisementId_idx" ON "IssuePagePlacement"("advertisementId");

ALTER TABLE "Issue"
    ADD CONSTRAINT "Issue_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES "Publication"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "IssuePage"
    ADD CONSTRAINT "IssuePage_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "Issue"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Article"
    ADD CONSTRAINT "Article_sourceSubmissionId_fkey"
    FOREIGN KEY ("sourceSubmissionId") REFERENCES "ContentSubmission"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Article"
    ADD CONSTRAINT "Article_createdByUserId_fkey"
    FOREIGN KEY ("createdByUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ArticlePublication"
    ADD CONSTRAINT "ArticlePublication_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "Article"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticlePublication"
    ADD CONSTRAINT "ArticlePublication_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES "Publication"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleImage"
    ADD CONSTRAINT "ArticleImage_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "Article"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssuePagePlacement"
    ADD CONSTRAINT "IssuePagePlacement_pageId_fkey"
    FOREIGN KEY ("pageId") REFERENCES "IssuePage"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssuePagePlacement"
    ADD CONSTRAINT "IssuePagePlacement_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "Article"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "IssuePagePlacement"
    ADD CONSTRAINT "IssuePagePlacement_advertisementId_fkey"
    FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
