import "server-only";
import { AgentTaskStatus, type Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

const maxInstructionsLength = 2000;

/** Editorial guidance shared by the Copywriter's review, apply and enhance prompts. */
export const EDITORIAL_GUIDANCE =
  "You are an experienced editor for a local community publication. Be constructive, specific, and practical. Focus on community storytelling quality.";

/**
 * Optional JSON body sent by the agent dialogs on a submission review: staff custom instructions
 * and the review the action was started from. A missing or malformed body means neither.
 */
export async function readSubmissionAgentRequest(request: Request) {
  let body: Record<string, unknown> = {};
  try {
    const text = await request.text();
    if (text) body = JSON.parse(text) as Record<string, unknown>;
  } catch {
    // keep the empty body
  }
  const instructions =
    typeof body.instructions === "string" ? body.instructions.trim().slice(0, maxInstructionsLength) : "";
  const reviewTaskId =
    typeof body.reviewTaskId === "string" && /^[\w-]{1,64}$/.test(body.reviewTaskId) ? body.reviewTaskId : null;
  const enhance = body.enhance === true;
  return { instructions, reviewTaskId, enhance };
}

/**
 * Completed Copywriter editorial reviews of a submission. Other Copywriter tasks on the same
 * submission (such as applied revisions) carry a different contentType and are excluded.
 */
export function submissionReviewsWhere(editorAgentId: number, submissionId: string): Prisma.AgentTaskWhereInput {
  return {
    agentId: editorAgentId,
    status: AgentTaskStatus.SUCCEEDED,
    AND: [
      { result: { path: ["referenceId"], equals: submissionId } },
      { result: { path: ["contentType"], equals: "submission" } },
    ],
  };
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : [];
}

/** The open items of an editorial review: what the submitter could still be asked for. */
export function reviewOpenItems(reviewResult: unknown) {
  const review = (reviewResult ?? {}) as Record<string, unknown>;
  return {
    missingElements: stringList(review.missingElements),
    suggestions: stringList(review.suggestions),
  };
}

/**
 * The complete feedback of a Copywriter editorial review as plain text, for agent prompts:
 * assessment, scores, headline suggestion, strengths, suggestions, missing elements, and the
 * changes since the previous review. Returns null when there is no review.
 */
export function formatReviewFeedback(reviewResult: unknown): string | null {
  if (!reviewResult || typeof reviewResult !== "object") return null;
  const review = reviewResult as Record<string, unknown>;
  const score = (value: unknown) => (typeof value === "number" ? `${value}/10` : "not scored");
  const section = (title: string, items: string[]) =>
    items.length ? `${title}:\n${items.map((item, index) => `${index + 1}. ${item}`).join("\n")}` : null;
  const parts = [
    typeof review.summary === "string" && review.summary ? `Editor's assessment: ${review.summary}` : null,
    `Scores: readability ${score(review.readabilityScore)}, community relevance ${score(review.communityRelevanceScore)}`,
    typeof review.headlineSuggestion === "string" && review.headlineSuggestion
      ? `Headline suggestion: ${review.headlineSuggestion}`
      : null,
    section("Strengths", stringList(review.strengths)),
    section("Suggestions", stringList(review.suggestions)),
    section("Missing elements", stringList(review.missingElements)),
    section("Resolved since the previous review", stringList(review.resolvedElements)),
    section("New concerns since the previous review", stringList(review.newConcerns)),
  ];
  return parts.filter(Boolean).join("\n\n");
}

/**
 * How much the Assistant may ask a story contributor for. Shared by the information request, the
 * replies in that conversation and the follow-ups so the contributor's effort stays minimal.
 */
export const CONTRIBUTOR_ASK_POLICY = `How much to ask (keep the contributor's effort minimal; never be pushy or annoying):
- Ask only for what the contributor alone can tell us and the story truly needs in order to run. At most 3 short questions, most important first. Leave out nice-to-haves.
- Never ask for what the team can work out or look up: a calendar date implied by a relative one ("this Friday" — resolve it from the date the story was submitted), the public address or details of a named venue, business or landmark, spellings of public places, general background.
- Do not ask them to confirm details that are plausible as written. Query something only if it is clearly contradictory and would mislead readers, and then offer your best guess so a one-word answer is enough.
- Partial answers are fine. Never re-ask something they already answered, skipped or declined. If some details stay missing, that's OK: the team will fill the gaps or run the story without them.`;

/** Dates the model needs to resolve relative dates ("this Friday") in a submission. */
export function submissionDatesNote(submittedAt: Date, now = new Date()): string {
  const format = (date: Date) =>
    date.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
  return `The story was submitted on ${format(submittedAt)}; today is ${format(now)}. Relative dates in the story ("this Friday", "next week") are relative to the submission date.`;
}

/**
 * One piece of information a submitter sent in reply to an info request. The Assistant records
 * these on the info-request task (`receivedInfo`) instead of editing the submission; the Copywriter
 * works them into the story when a person applies a review.
 */
export type ReceivedInfoItem = { topic: string; detail: string; messageId: string | null; receivedAt: string };

export function readReceivedInfo(value: unknown): ReceivedInfoItem[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    const detail = typeof record.detail === "string" ? record.detail.trim() : "";
    if (!detail) return [];
    return [{
      topic: typeof record.topic === "string" ? record.topic.trim() : "",
      detail,
      messageId: typeof record.messageId === "string" ? record.messageId : null,
      receivedAt: typeof record.receivedAt === "string" ? record.receivedAt : "",
    }];
  });
}

/**
 * Information received from the submitter on every info request about a submission, oldest first,
 * with the review each request was started from.
 */
export async function getSubmissionReceivedInfo(submissionId: string) {
  const requests = await prisma.agentTask.findMany({
    where: {
      AND: [
        { result: { path: ["contentType"], equals: "clarification" } },
        { result: { path: ["referenceId"], equals: submissionId } },
      ],
    },
    orderBy: { createdAt: "asc" },
    select: { result: true },
  });
  return requests.flatMap((request) => {
    const result = (request.result ?? {}) as Record<string, unknown>;
    const reviewTaskId = typeof result.reviewTaskId === "string" ? result.reviewTaskId : null;
    return readReceivedInfo(result.receivedInfo).map((item) => ({ ...item, reviewTaskId }));
  });
}

/** Received information as a numbered plain-text list for agent prompts, or null when there is none. */
export function formatReceivedInfo(items: ReceivedInfoItem[]): string | null {
  if (!items.length) return null;
  return items
    .map((item, index) => {
      const date = item.receivedAt ? ` (${item.receivedAt.slice(0, 10)})` : "";
      return `${index + 1}. ${item.topic ? `${item.topic}: ` : ""}${item.detail}${date}`;
    })
    .join("\n");
}
