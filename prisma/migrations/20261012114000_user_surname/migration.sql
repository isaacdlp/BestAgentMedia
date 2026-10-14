ALTER TABLE "User"
ADD COLUMN "surname" TEXT NOT NULL DEFAULT '';

UPDATE "User"
SET
  "surname" = regexp_replace(btrim("name"), '^\S+\s*', ''),
  "name" = COALESCE(substring(btrim("name") FROM '^\S+'), '');
