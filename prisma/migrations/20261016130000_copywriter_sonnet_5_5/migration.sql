-- Move the Copywriter from Claude Sonnet 4.5 to Claude Sonnet 5.5 (supports effort; faster and
-- cheaper). Only rows still on the old default are changed, so a deliberately chosen model is kept.
-- A fresh database gets the same value from prisma/seed.ts.
UPDATE "Agent"
SET "settings" = jsonb_set("settings", '{model}', '"claude-sonnet-5-5"'::jsonb)
WHERE "slug" = 'editor'
  AND ("settings" ->> 'model' IS NULL OR "settings" ->> 'model' IN ('claude-sonnet-4-5', 'claude-sonnet-4-5-20250929'));
