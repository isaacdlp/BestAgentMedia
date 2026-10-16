import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MessageDirection } from "@prisma/client";
import { z } from "zod";
import { effortFor, MAX_OUTPUT_TOKENS } from "@/lib/claude-request";

const REPLY_MODEL = "claude-sonnet-5-5";

/** What the Assistant should know about Best Version Media when talking to a business owner or resident. */
export const COMPANY_BRIEF = `About Best Version Media (BVM):
- BVM publishes hyper-local community magazines. Each publication serves one specific neighborhood or ZIP code and is delivered free to the residents who live there.
- The content is about the community itself: neighbors' milestones, local events, school and sports news, resident profiles, and spotlights on the local businesses people already use. Residents can submit their own stories.
- The magazines are funded by local business partners who advertise or sponsor features. That is what keeps them free for readers.
- Why it matters to a local business: the readers are the people who live within a few miles of them, the magazine sits on kitchen tables for weeks, and it is a trusted, positive, community setting rather than a cold ad. It works best for businesses that depend on neighborhood customers (home services, restaurants, health and wellness, real estate, retail, professional services).

What the business directory listing is:
- We have already listed the business in our local directory for the publication, using public information.
- Claiming the listing is completely free, has no obligation, and needs no payment details. It takes a minute: create an account through the claim link.
- Once claimed, the owner can correct and update their details, submit community news or stories about their business, and see advertising and sponsored-feature options for their publication if they are interested.

About cost (people ask this a lot; answer it plainly and first):
- Claiming and keeping the listing costs nothing, now or later. Nobody will be charged for doing it.
- Advertising and sponsored features are optional and paid. Pricing depends on the publication, the size and type of placement, and how often it runs, so you do not have numbers to quote. If they are curious, offer to have the publication team put together options for them, with no commitment.
- Never invent prices, discounts, circulation figures, readership statistics, deadlines, or results.`;

const STYLE_GUIDE = `How to write:
- You are a real member of the local publication team writing a personal email back to someone. Read their message carefully and respond to what they actually said.
- Answer their question directly in the first sentence or two. If they ask "will this cost me money?", the first thing they read should be a clear, honest answer.
- Then add only the context that helps them decide. Explain things the way you would to a neighbor: plain words, short paragraphs, no marketing buzzwords, no bullet-point brochure, and do not repeat the pitch they already received.
- Match their tone and length. A one-line question deserves a short, friendly reply (usually 3 to 7 sentences). A detailed message can get a fuller answer.
- Use contractions and a warm, natural voice that fits your persona. Use their first name if you know it.
- Offer at most one clear next step. Include the claim link only when it helps (for example when they seem interested or ask how to start), and only once.
- If it feels natural, ask one light question about their business so the conversation can continue.
- If they are not interested, are annoyed, or ask not to be contacted, be gracious, don't push, confirm you will not email them again about this, and set opted_out to true.
- If they ask something you don't know (a specific price, a print date, a contract detail), say so honestly and offer to check with the publication team. Do not make up facts or claim you already did something you did not do.
- If they sincerely ask whether they are talking to a person or an automated assistant, answer honestly.
- Stay on topic: BVM, their publication, their listing, advertising, and community stories. If they bring up something unrelated, respond kindly in a sentence and steer back.
- Plain text only. No subject line, no headers, no markdown. End with a short sign-off and your first name; your full email signature is added automatically.`;

const ReplySchema = z.object({
  reply: z.string().describe("The plain-text body of the email reply."),
  opted_out: z.boolean().describe("True when the person declined or asked not to be contacted again."),
});

export type ThreadMessage = {
  direction: MessageDirection;
  bodyText: string;
  sentAt: Date | null;
  receivedAt: Date | null;
  createdAt: Date;
};

/** Where a quote header ("On <date> <name> wrote:", possibly wrapped over up to 3 lines) ends, or -1. */
function quoteHeaderEnd(lines: string[], from: number): number {
  if (!/^On\b/.test(lines[from].trim())) return -1;
  for (let end = from; end < Math.min(lines.length, from + 3); end++) {
    const text = lines.slice(from, end + 1).map((line) => line.trim()).join(" ");
    if (/\bwrote:\s*$/.test(text)) return end;
  }
  return -1;
}

/**
 * Removes the quoted earlier message ("On ... wrote:" and "> " lines) that mail clients append to
 * replies. When the person answered inline (their text interleaved with the quoted lines), the
 * single-level quoted lines are kept so each answer stays next to the question it responds to;
 * deeper quotes (">>", older messages) are dropped.
 */
export function stripQuotedText(body: string): string {
  const lines = body.split(/\r?\n/);
  let quoteStart = lines.length;
  let restStart = lines.length;
  for (let i = 0; i < lines.length; i++) {
    if (/^-{2,}\s*Original Message\s*-{2,}/i.test(lines[i].trim())) {
      // Outlook-style quotes have no ">" markers, so inline answers cannot be told apart
      quoteStart = i;
      break;
    }
    const headerEnd = quoteHeaderEnd(lines, i);
    if (headerEnd >= 0 || lines[i].startsWith(">")) {
      quoteStart = i;
      restStart = headerEnd >= 0 ? headerEnd + 1 : i;
      break;
    }
  }

  const own = lines.slice(0, quoteStart).join("\n").trim();
  const rest = lines.slice(restStart);
  const firstQuote = rest.findIndex((line) => line.startsWith(">"));
  const answeredInline = firstQuote >= 0 && rest.slice(firstQuote).some((line) => !line.startsWith(">") && line.trim() !== "");
  if (!answeredInline) return own || body.trim();

  const inline = rest
    .filter((line) => !/^>\s*>/.test(line))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [own, inline].filter(Boolean).join("\n\n");
}

/** Tells the model how inline answers appear in a transcript rendered by renderTranscript. */
export const INLINE_REPLY_NOTE =
  'Lines starting with ">" quote an earlier email; text between those lines is the sender\'s inline answer to the quoted line(s) just above it. Treat inline answers as part of their message.';

export function renderTranscript(messages: ThreadMessage[], agentName: string, otherName: string): string {
  return messages
    .map((msg) => {
      const from = msg.direction === MessageDirection.OUTBOUND ? `${agentName} (you)` : otherName;
      const when = (msg.sentAt ?? msg.receivedAt ?? msg.createdAt).toISOString().slice(0, 16).replace("T", " ");
      return `--- From: ${from} — ${when} UTC ---\n${stripQuotedText(msg.bodyText)}`;
    })
    .join("\n\n");
}

/**
 * Asks Claude for a human, helpful reply to the latest inbound message on a thread.
 * Returns null when CLAUDE_KEY is not configured or the model returns nothing usable.
 */
export async function generateAssistantReply(opts: {
  agent: { name: string; soul: string };
  messages: ThreadMessage[];
  /** Name of the person or business being written to. */
  recipientName?: string | null;
  /** Facts specific to this conversation (business, publication, links). */
  context?: string[];
}): Promise<{ reply: string; optedOut: boolean } | null> {
  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    console.warn("[AssistantReply] CLAUDE_KEY is not set in the server environment — no AI reply generated.");
    return null;
  }

  const firstName = opts.agent.name.split(/\s+/)[0];
  const system = [
    `You are ${opts.agent.name}, part of the local publication team at Best Version Media, replying by email.`,
    opts.agent.soul ? `Your persona: ${opts.agent.soul}` : "",
    COMPANY_BRIEF,
    opts.context?.length ? `About this conversation:\n${opts.context.map((line) => `- ${line}`).join("\n")}` : "",
    STYLE_GUIDE,
    `Sign off as ${firstName}.`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const otherName = opts.recipientName || "Them";
  const transcript = renderTranscript(opts.messages, opts.agent.name, otherName);

  const client = new Anthropic({ apiKey });
  // Structured output guarantees a schema-valid reply (forced tool use is rejected by current
  // models, and a plain-text fallback could send a reply cut off at max_tokens).
  const response = await client.messages
    .stream({
      model: REPLY_MODEL,
      max_tokens: MAX_OUTPUT_TOKENS,
      system,
      // A conversational email reply needs little deliberation
      output_config: { format: zodOutputFormat(ReplySchema), ...effortFor(REPLY_MODEL, "low") },
      messages: [
        {
          role: "user",
          content: `Here is the email conversation so far, oldest first:\n\n${transcript}\n\n${INLINE_REPLY_NOTE}\n\nWrite your reply to the most recent message from ${otherName}.`,
        },
      ],
    })
    .finalMessage();

  const output = response.parsed_output;
  const reply = output?.reply.trim() ?? "";
  if (!reply) {
    console.warn(`[AssistantReply] No usable reply (stop reason: ${response.stop_reason}).`);
    return null;
  }
  return { reply, optedOut: output?.opted_out === true };
}
