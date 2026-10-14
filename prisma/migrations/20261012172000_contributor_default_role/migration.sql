BEGIN;

ALTER TYPE "UserRole" RENAME TO "UserRole_old";
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'PUBLISHER');

ALTER TABLE "User" ALTER COLUMN "role" DROP NOT NULL;
ALTER TABLE "User"
ALTER COLUMN "role" TYPE "UserRole"
USING (
    CASE
        WHEN "role"::TEXT IN ('ADMIN', 'PUBLISHER') THEN "role"::TEXT
        ELSE NULL
    END
)::"UserRole";

DROP TYPE "UserRole_old";

COMMIT;
