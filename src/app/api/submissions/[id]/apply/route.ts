import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { MessageDirection, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSubmissionScope } from "@/lib/access";
import { launchAgentTask, step } from "@/lib/agent-task-runner";
import { getCurrentUser } from "@/lib/auth";
import { effortFor, MAX_OUTPUT_TOKENS } from "@/lib/claude-request";
import { prisma } from "@/lib/db";
import {
  EDITORIAL_GUIDANCE,
  formatReceivedInfo,
  formatReviewFeedback,
  getSubmissionReceivedInfo,
  readSubmissionAgentRequest,
  submissionDatesNote,
  submissionReviewsWhere,
} from "@/lib/submission-agent-requests";
import { z } from "zod";

export const maxDuration = 300;

const RevisionSchema = z.object({
  title: z.string().describe("Revised title (keep the current one if no change is warranted)."),
  body: z.string().describe("Revised full story body."),
  changes: z.array(z.string()).describe("Short description of each change made."),
  unresolved: z.array(z.string()).describe("Review items that could not be addressed with the information available."),
});

const maxReplyLength = 6000;

/**
 * Launches a Copywriter Task that proposes a revised title and body for the submission from the
 * submission's details, an editorial review's feedback and the info-request conversation with the
 * submitter. The submission is not changed: the task page shows the current and proposed versions
 * side by side, and the proposal is written only when a person accepts it
 * (`/api/submissions/[id]/apply/[taskId]`).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to apply review feedback." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot edit submissions." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const agent = await prisma.agent.findUnique({
    where: { slug: "editor" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Copywriter agent is not configured. Run the database seed." }, { status: 503 });
  }
  if (!agent.enabled) {
    return NextResponse.json({ error: "The Copywriter agent is currently disabled. Enable it in the Agents section." }, { status: 503 });
  }

  const scope = await getSubmissionScope(user);
  if (!scope) {
    return NextResponse.json({ error: "You cannot access this submission." }, { status: 403 });
  }

  const submission = await prisma.contentSubmission.findFirst({
    where: { id, ...scope },
    select: {
      id: true,
      title: true,
      body: true,
      storyType: true,
      submitterName: true,
      postalCode: true,
      createdAt: true,
      publication: { select: { name: true } },
      business: { select: { name: true } },
      images: { orderBy: { createdAt: "asc" }, select: { originalName: true } },
    },
  });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Applying feedback is not configured (missing CLAUDE_KEY)." }, { status: 503 });
  }

  const { instructions, reviewTaskId, enhance } = await readSubmissionAgentRequest(request);
  // Enhance works from the article alone: no review feedback, replies or recorded info
  const review = enhance ? null : await prisma.agentTask.findFirst({
    where: {
      ...submissionReviewsWhere(agent.id, submission.id),
      ...(reviewTaskId ? { id: reviewTaskId } : {}),
    },
    orderBy: { completedAt: "desc" },
    select: { id: true, result: true },
  });
  if (!enhance && !review) {
    return NextResponse.json({ error: "Review not found for this submission." }, { status: 404 });
  }

  // The info-request conversations about this submission: the questions asked and the submitter's replies
  const messages = enhance ? [] : await prisma.emailMessage.findMany({
    where: {
      thread: {
        task: {
          AND: [
            { result: { path: ["contentType"], equals: "clarification" } },
            { result: { path: ["referenceId"], equals: submission.id } },
          ],
        },
      },
    },
    orderBy: { createdAt: "asc" },
    select: { id: true, direction: true, bodyText: true, sentAt: true, receivedAt: true, createdAt: true },
  });
  const conversation = messages.filter((message) => message.bodyText.trim());
  const receivedInfo = enhance ? [] : await getSubmissionReceivedInfo(submission.id);
  const usableReplies = conversation.filter((message) => message.direction === MessageDirection.INBOUND);

  const agentSettings = (agent.settings as Record<string, unknown>) ?? {};
  const model = typeof agentSettings.model === "string" ? agentSettings.model : "claude-sonnet-5-5";
  // Streamed, so a high ceiling is safe; thinking counts toward it and only generated tokens are billed
  const maxOutputTokens = Math.max(typeof agentSettings.maxOutputTokens === "number" ? agentSettings.maxOutputTokens : 0, MAX_OUTPUT_TOKENS);

  const reviewResult = (review?.result ?? {}) as Record<string, unknown>;
  const suggestions = stringList(reviewResult.suggestions);
  const missingElements = stringList(reviewResult.missingElements);
  const headlineSuggestion = typeof reviewResult.headlineSuggestion === "string" ? reviewResult.headlineSuggestion : null;
  const reviewFeedback = review ? formatReviewFeedback(review.result) ?? "(no feedback recorded)" : null;

  const initialSteps = !review ? [step("info", `Enhancing submission "${submission.title}" from the article alone (no review or replies)`)] : [
    step("info", `Applying editorial review ${review.id} to submission "${submission.title}"`),
    step("info", `Review items: ${suggestions.length} suggestion(s), ${missingElements.length} missing element(s)${headlineSuggestion ? ", headline suggestion" : ""}`),
    usableReplies.length
      ? step("info", `Including ${usableReplies.length} reply message(s) from the submitter`)
      : step("info", "No replies from the submitter yet — applying review feedback only"),
  ];
  if (receivedInfo.length) {
    initialSteps.push(step("info", `Including ${receivedInfo.length} item(s) of information the Assistant recorded from the replies`));
  }
  if (instructions) {
    initialSteps.push(step("info", `Custom instructions: ${instructions}`));
  }

  const task = await launchAgentTask({
    agentId: agent.id,
    label: `${enhance ? "Enhance" : "Revise"} · Submission · ${submission.title}`,
    subject: { type: "submission", id: submission.id },
    triggeredById: user.id,
    steps: initialSteps,
    work: async ({ log }) => {
      const conversationText = conversation
        .map((message) => {
          const date = (message.receivedAt ?? message.sentAt ?? message.createdAt).toISOString().slice(0, 10);
          const from = message.direction === MessageDirection.INBOUND ? "Contributor's reply" : "Our message to the contributor";
          return `--- ${from} (${date}) ---\n${message.bodyText.trim().slice(0, maxReplyLength)}`;
        })
        .join("\n\n");
      const details = [
        `Publication: ${submission.publication.name}`,
        `Story type: ${submission.storyType ?? "unspecified"}`,
        submission.submitterName ? `Contributor: ${submission.submitterName}` : null,
        submission.postalCode ? `ZIP code: ${submission.postalCode}` : null,
        submission.business ? `Related business: ${submission.business.name}` : null,
        `Attached photos: ${submission.images.length ? submission.images.map((image) => image.originalName).join(", ") : "none"}`,
        submissionDatesNote(submission.createdAt),
      ].filter(Boolean).join("\n");

      log("info", `Calling ${model} to draft the revision`);
      const client = new Anthropic({ apiKey });
      const message = await client.messages.stream({
        model,
        max_tokens: maxOutputTokens,
        output_config: { format: zodOutputFormat(RevisionSchema), ...effortFor(model, "medium") },
        system: `${EDITORIAL_GUIDANCE} You revise contributor submissions so they are ready for print: you improve clarity, flow and style, apply editorial feedback when given, and fold in facts the contributor supplied, keeping the contributor's voice. You never invent names, dates, quotes, numbers or other facts that are not in the submission or the contributor's replies.`,
        messages: [
          {
            role: "user",
            content: `Revise this community story submission.

${details}

Current title: ${submission.title}

Current body:
${submission.body}

${enhance ? "" : `Editorial review feedback:
${reviewFeedback}

Information the contributor sent by email, recorded by the editorial assistant (it is NOT in the body yet; work it in):
${formatReceivedInfo(receivedInfo) ?? "(none recorded)"}

Full email conversation with the contributor, for context:
${conversationText || "(no conversation yet)"}
`}${instructions ? `\nAdditional instructions from the editorial team (follow them):\n${instructions}\n` : ""}
Rules:
- ${enhance ? "Improve the story's clarity, structure, grammar and headline using only what the submission already says." : "Apply the suggestions that can be applied with the information available."}
- Fill missing elements ONLY with information from the submission, the recorded information or the contributor's replies; if something is still unknown, leave it out rather than inventing it, and list it under "unresolved".
- Work each piece of recorded information into the story where it belongs, without duplicating what the body already says.
- Keep it as plain text with paragraphs separated by blank lines.`,
          },
        ],
      }).finalMessage();
      log("info", `Response received — input: ${message.usage.input_tokens} tokens, output: ${message.usage.output_tokens} tokens`);

      const revision = message.parsed_output;
      if (!revision) {
        throw new Error(`The model returned no revision (stop reason: ${message.stop_reason}) — submission left unchanged`);
      }
      const title = revision.title.trim() ? revision.title.trim().slice(0, 200) : submission.title;
      const body = revision.body.trim().slice(0, 20_000);
      if (body.length < 50) {
        throw new Error("Model returned an empty or too-short body — submission left unchanged");
      }

      const changes = stringList(revision.changes);
      const unresolved = stringList(revision.unresolved);
      log("success", `Revision ready (${title !== submission.title ? "title and body" : "body"}) — ${changes.length} change(s). The submission is unchanged until the revision is accepted`);
      if (unresolved.length) {
        log("info", `Unresolved: ${unresolved.join("; ")}`);
      }

      return {
        contentType: "submission-revision",
        referenceId: submission.id,
        referenceTitle: title,
        reviewTaskId: review?.id ?? null,
        replyMessageIds: usableReplies.map((reply) => reply.id),
        receivedInfoCount: receivedInfo.length,
        instructions,
        changes,
        unresolved,
        status: "pending_review",
        proposedTitle: title,
        proposedBody: body,
        previousTitle: submission.title,
        previousBody: submission.body,
      };
    },
  });

  return NextResponse.json({ task }, { status: 202 });
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
