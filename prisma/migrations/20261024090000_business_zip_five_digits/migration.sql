-- Normalize existing business postal codes to exactly five digits (ZIP+4 -> ZIP, 4 digits -> zero-padded).
UPDATE "Business"
SET "postalCode" = CASE
  WHEN btrim("postalCode") ~ '^\d{5}([- ]?\d{4})?$' THEN substring(btrim("postalCode") from 1 for 5)
  WHEN btrim("postalCode") ~ '^\d{4}([- ]?\d{4})?$' THEN lpad(substring(btrim("postalCode") from 1 for 4), 5, '0')
  ELSE NULL
END
WHERE "postalCode" IS NOT NULL;

ALTER TABLE "Business"
  ADD CONSTRAINT "Business_postalCode_five_digits" CHECK ("postalCode" IS NULL OR "postalCode" ~ '^\d{5}$');
