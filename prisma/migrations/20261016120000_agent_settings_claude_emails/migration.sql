-- Agent settings after moving all agent emails to Claude-written messages and streaming every
-- Claude call. Existing rows only; a fresh database gets the same values from prisma/seed.ts.

-- Claude calls are streamed now, so output ceilings are raised to 64K (thinking counts toward
-- max_tokens; only generated tokens are billed).
UPDATE "Agent"
SET "settings" = jsonb_set("settings", '{maxOutputTokens}', '64000'::jsonb)
WHERE "slug" IN ('editor', 'designer')
  AND COALESCE(("settings" ->> 'maxOutputTokens')::int, 0) < 64000;

-- Assistant: submitter invites and business onboarding emails are written by Claude, so the
-- template settings are gone. Keep each "enabled" flag and any existing guidance.
UPDATE "Agent"
SET "settings" = ("settings" - 'businessInvite' - 'submissionInvite' - 'onboarding')
  || jsonb_build_object(
    'submissionInvite',
    jsonb_build_object(
      'enabled', COALESCE("settings" #> '{submissionInvite,enabled}', 'true'::jsonb),
      'instructions', COALESCE("settings" #> '{submissionInvite,instructions}', '""'::jsonb)
    )
    || CASE WHEN "settings" #> '{submissionInvite,model}' IS NULL THEN '{}'::jsonb
       ELSE jsonb_build_object('model', "settings" #> '{submissionInvite,model}') END,
    'onboarding',
    (COALESCE("settings" -> 'onboarding', '{}'::jsonb)
      - 'initialSubject' - 'initialBody'
      - 'reminder1Subject' - 'reminder1Body'
      - 'reminder2Subject' - 'reminder2Body')
    || jsonb_build_object('instructions', COALESCE("settings" #> '{onboarding,instructions}', '""'::jsonb))
  ),
  "description" = 'Writes personal emails with Claude: invitations for new story submitters (queued as drafts for review), onboarding emails and reminders to newly listed businesses, and information requests to submitters, which it sends and follows through until the requested details arrive.'
WHERE "slug" = 'assistant';

UPDATE "Agent"
SET "description" = 'Reviews content submissions and articles for editorial quality, suggesting headline improvements, structural changes, and clarity fixes, and applies a review on request by revising the submission with the feedback and any details the submitter sent.'
WHERE "slug" = 'editor';
