-- Ads and articles now belong to specific Issues (many-to-many) instead of Publications.
-- Existing publication links are dropped; items become unassigned until an Issue is chosen.
DROP TABLE "AdvertisementPublication";
DROP TABLE "ArticlePublication";

CREATE TABLE "AdvertisementIssue" (
    "advertisementId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    CONSTRAINT "AdvertisementIssue_pkey" PRIMARY KEY ("advertisementId","issueId")
);

CREATE TABLE "ArticleIssue" (
    "articleId" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    CONSTRAINT "ArticleIssue_pkey" PRIMARY KEY ("articleId","issueId")
);

CREATE INDEX "AdvertisementIssue_issueId_idx" ON "AdvertisementIssue"("issueId");
CREATE INDEX "ArticleIssue_issueId_idx" ON "ArticleIssue"("issueId");

ALTER TABLE "AdvertisementIssue"
    ADD CONSTRAINT "AdvertisementIssue_advertisementId_fkey"
    FOREIGN KEY ("advertisementId") REFERENCES "Advertisement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AdvertisementIssue"
    ADD CONSTRAINT "AdvertisementIssue_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleIssue"
    ADD CONSTRAINT "ArticleIssue_articleId_fkey"
    FOREIGN KEY ("articleId") REFERENCES "Article"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArticleIssue"
    ADD CONSTRAINT "ArticleIssue_issueId_fkey"
    FOREIGN KEY ("issueId") REFERENCES "Issue"("id") ON DELETE CASCADE ON UPDATE CASCADE;
