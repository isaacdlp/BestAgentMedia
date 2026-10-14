BEGIN;

CREATE TEMPORARY TABLE "_PublicationIdMap" ON COMMIT DROP AS
SELECT
    "id" AS "oldId",
    ROW_NUMBER() OVER (ORDER BY "createdAt", "id")::INTEGER AS "newId"
FROM "Publication";

ALTER TABLE "Publication" ADD COLUMN "internalId" INTEGER;
UPDATE "Publication" AS publication
SET "internalId" = id_map."newId"
FROM "_PublicationIdMap" AS id_map
WHERE publication."id" = id_map."oldId";

CREATE SEQUENCE "Publication_id_seq";
SELECT setval(
    '"Publication_id_seq"',
    COALESCE(MAX("internalId"), 1),
    MAX("internalId") IS NOT NULL
)
FROM "Publication";

ALTER TABLE "PublicationPublisher" ADD COLUMN "publicationInternalId" INTEGER;
UPDATE "PublicationPublisher" AS assignment
SET "publicationInternalId" = id_map."newId"
FROM "_PublicationIdMap" AS id_map
WHERE assignment."publicationId" = id_map."oldId";

ALTER TABLE "ContentSubmission" ADD COLUMN "publicationInternalId" INTEGER;
UPDATE "ContentSubmission" AS submission
SET "publicationInternalId" = id_map."newId"
FROM "_PublicationIdMap" AS id_map
WHERE submission."publicationId" = id_map."oldId";

ALTER TABLE "Advertisement" ADD COLUMN "publicationInternalId" INTEGER;
UPDATE "Advertisement" AS advertisement
SET "publicationInternalId" = id_map."newId"
FROM "_PublicationIdMap" AS id_map
WHERE advertisement."publicationId" = id_map."oldId";

ALTER TABLE "_PublicationToZipCode" ADD COLUMN "publicationInternalId" INTEGER;
UPDATE "_PublicationToZipCode" AS publication_zip
SET "publicationInternalId" = id_map."newId"
FROM "_PublicationIdMap" AS id_map
WHERE publication_zip."A" = id_map."oldId";

ALTER TABLE "PublicationPublisher"
    DROP CONSTRAINT "PublicationPublisher_publicationId_fkey";
ALTER TABLE "ContentSubmission"
    DROP CONSTRAINT "ContentSubmission_publicationId_fkey";
ALTER TABLE "Advertisement"
    DROP CONSTRAINT "Advertisement_publicationId_fkey";
ALTER TABLE "_PublicationToZipCode"
    DROP CONSTRAINT "_PublicationToZipCode_A_fkey";

DROP INDEX "PublicationPublisher_publicationId_idx";
DROP INDEX "ContentSubmission_publicationId_status_idx";
DROP INDEX "Advertisement_publicationId_status_idx";

ALTER TABLE "PublicationPublisher"
    DROP CONSTRAINT "PublicationPublisher_pkey";
ALTER TABLE "_PublicationToZipCode"
    DROP CONSTRAINT "_PublicationToZipCode_AB_pkey";
ALTER TABLE "Publication"
    DROP CONSTRAINT "Publication_pkey";

ALTER TABLE "PublicationPublisher" DROP COLUMN "publicationId";
ALTER TABLE "PublicationPublisher"
    RENAME COLUMN "publicationInternalId" TO "publicationId";
ALTER TABLE "ContentSubmission" DROP COLUMN "publicationId";
ALTER TABLE "ContentSubmission"
    RENAME COLUMN "publicationInternalId" TO "publicationId";
ALTER TABLE "Advertisement" DROP COLUMN "publicationId";
ALTER TABLE "Advertisement"
    RENAME COLUMN "publicationInternalId" TO "publicationId";
ALTER TABLE "_PublicationToZipCode" DROP COLUMN "A";
ALTER TABLE "_PublicationToZipCode"
    RENAME COLUMN "publicationInternalId" TO "A";
ALTER TABLE "Publication" DROP COLUMN "id";
ALTER TABLE "Publication" RENAME COLUMN "internalId" TO "id";

ALTER TABLE "Publication"
    ALTER COLUMN "id" SET DEFAULT nextval('"Publication_id_seq"');
ALTER SEQUENCE "Publication_id_seq" OWNED BY "Publication"."id";

ALTER TABLE "Publication"
    ADD CONSTRAINT "Publication_pkey" PRIMARY KEY ("id");
ALTER TABLE "PublicationPublisher"
    ADD CONSTRAINT "PublicationPublisher_pkey"
    PRIMARY KEY ("userId", "publicationId");
ALTER TABLE "_PublicationToZipCode"
    ADD CONSTRAINT "_PublicationToZipCode_AB_pkey"
    PRIMARY KEY ("A", "B");

CREATE INDEX "PublicationPublisher_publicationId_idx"
    ON "PublicationPublisher"("publicationId");
CREATE INDEX "ContentSubmission_publicationId_status_idx"
    ON "ContentSubmission"("publicationId", "status");
CREATE INDEX "Advertisement_publicationId_status_idx"
    ON "Advertisement"("publicationId", "status");

ALTER TABLE "PublicationPublisher"
    ADD CONSTRAINT "PublicationPublisher_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES "Publication"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ContentSubmission"
    ADD CONSTRAINT "ContentSubmission_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES "Publication"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Advertisement"
    ADD CONSTRAINT "Advertisement_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES "Publication"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "_PublicationToZipCode"
    ADD CONSTRAINT "_PublicationToZipCode_A_fkey"
    FOREIGN KEY ("A") REFERENCES "Publication"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

COMMIT;
