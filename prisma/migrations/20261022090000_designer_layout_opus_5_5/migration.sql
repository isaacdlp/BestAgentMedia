-- Issue layout composition now defaults to Claude Opus 5.5 at high effort. Only Designer rows
-- still on the earlier defaults (Claude Fable 5.1 at xhigh) are changed, so a deliberately chosen
-- model or effort is kept. A fresh database gets the same values from prisma/seed.ts.
UPDATE "Agent"
SET "settings" = jsonb_set("settings", '{layoutModel}', '"claude-opus-5-5"'::jsonb)
WHERE "slug" = 'designer'
  AND "settings" ->> 'layoutModel' = 'claude-fable-5-1';

UPDATE "Agent"
SET "settings" = jsonb_set("settings", '{layoutEffort}', '"high"'::jsonb)
WHERE "slug" = 'designer'
  AND "settings" ->> 'layoutEffort' = 'xhigh';
