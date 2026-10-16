import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { effortFor, MAX_OUTPUT_TOKENS } from "@/lib/claude-request";

const EmailSchema = z.object({
  subject: z.string().describe("A short, personal subject line specific to this recipient."),
  body: z.string().describe("The plain-text body of the email, starting with the greeting."),
});

const SYSTEM_PROMPT =
  "You are a member of a local community magazine's publication team who has an ongoing, friendly relationship with local story contributors. You write personal, specific emails that feel genuinely human, never form letters. You never invent facts about the story, the contributor or the publication.";

/**
 * Asks Claude to write a personal email (subject and body), by default to a story contributor.
 * Uses structured outputs so the reply is always a schema-valid subject and body. When
 * `requiredLink` is given and the draft leaves it out, Claude is asked once to revise; if it is
 * still missing the call throws, so no fixed text is ever added to the email.
 */
export async function draftContributorEmail({
  apiKey,
  model,
  prompt,
  requiredLink,
  system = SYSTEM_PROMPT,
}: {
  apiKey: string;
  model: string;
  /** Replaces the default story-contributor persona (for example for business owners). */
  system?: string;
  /** The writing brief: who the recipient is, what to say, and any guidance. */
  prompt: string;
  requiredLink?: string;
}): Promise<{ subject: string; body: string; revisedForLink: boolean }> {
  const client = new Anthropic({ apiKey });
  const messages: Anthropic.MessageParam[] = [{ role: "user", content: prompt }];

  let draft = await requestDraft(client, model, system, messages);
  if (!requiredLink || draft.body.includes(requiredLink)) return { ...draft, revisedForLink: false };

  messages.push(
    { role: "assistant", content: JSON.stringify(draft) },
    {
      role: "user",
      content: `The email must include this link on its own line, exactly: ${requiredLink}\nRevise the email naturally to include it.`,
    },
  );
  draft = await requestDraft(client, model, system, messages);
  if (!draft.body.includes(requiredLink)) {
    throw new Error(`The drafted email does not include the required link (${requiredLink}); try again.`);
  }
  return { ...draft, revisedForLink: true };
}

async function requestDraft(client: Anthropic, model: string, system: string, messages: Anthropic.MessageParam[]) {
  const message = await client.messages
    .stream({
      model,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      messages,
      // A personal email needs little deliberation; low effort keeps it quick and cheap
      output_config: { format: zodOutputFormat(EmailSchema), ...effortFor(model, "low") },
    })
    .finalMessage();
  if (message.stop_reason === "refusal") {
    throw new Error(`The model declined to write this email${message.stop_details?.category ? ` (${message.stop_details.category})` : ""}.`);
  }
  const draft = message.parsed_output;
  const subject = draft?.subject.trim() ?? "";
  const body = draft?.body.trim() ?? "";
  if (!subject || !body) {
    throw new Error(`The model did not return an email subject and body (stop reason: ${message.stop_reason}).`);
  }
  return { subject: subject.slice(0, 200), body };
}
