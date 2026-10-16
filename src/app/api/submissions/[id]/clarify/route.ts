import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSubmissionScope } from "@/lib/access";
import { launchAgentTask, step } from "@/lib/agent-task-runner";
import { getCurrentUser } from "@/lib/auth";
import { draftContributorEmail } from "@/lib/contributor-email";
import { prisma } from "@/lib/db";
import { findAssistantSubAgent } from "@/lib/reachout-tasks";
import { sendSubAgentEmail } from "@/lib/sub-agent-email";
import {
  CONTRIBUTOR_ASK_POLICY,
  formatReviewFeedback,
  readSubmissionAgentRequest,
  reviewOpenItems,
  submissionDatesNote,
  submissionReviewsWhere,
} from "@/lib/submission-agent-requests";

export const maxDuration = 300;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to request clarification." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot request clarification on submissions." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const assistantAgent = await prisma.agent.findUnique({
    where: { slug: "assistant" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!assistantAgent) {
    return NextResponse.json({ error: "Assistant agent is not configured. Run the database seed." }, { status: 503 });
  }
  if (!assistantAgent.enabled) {
    return NextResponse.json({ error: "The Assistant agent is currently disabled. Enable it in the Agents section." }, { status: 503 });
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
      submitterName: true,
      submitterEmail: true,
      body: true,
      storyType: true,
      createdAt: true,
      publication: { select: { name: true } },
    },
  });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }
  const submitterEmail = submission.submitterEmail;
  if (!submitterEmail) {
    return NextResponse.json({ error: "This submission has no submitter email address on file." }, { status: 400 });
  }

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Clarification drafting is not configured (missing CLAUDE_KEY)." }, { status: 503 });
  }

  const { instructions, reviewTaskId } = await readSubmissionAgentRequest(request);

  // Use the review the request was started from (or the most recent one) for context
  const editorAgent = await prisma.agent.findUnique({
    where: { slug: "editor" },
    select: { id: true },
  });
  const latestReview = editorAgent
    ? await prisma.agentTask.findFirst({
        where: {
          ...submissionReviewsWhere(editorAgent.id, submission.id),
          ...(reviewTaskId ? { id: reviewTaskId } : {}),
        },
        orderBy: { completedAt: "desc" },
        select: { id: true, result: true },
      })
    : null;
  if (reviewTaskId && !latestReview) {
    return NextResponse.json({ error: "Review not found for this submission." }, { status: 404 });
  }

  const { missingElements, suggestions } = reviewOpenItems(latestReview?.result);
  const reviewFeedback = formatReviewFeedback(latestReview?.result);

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const editUrl = `${appUrl}/submissions/${submission.id}`;

  const agentSettings = (assistantAgent.settings as Record<string, unknown>) ?? {};
  const model =
    typeof agentSettings.clarificationModel === "string"
      ? agentSettings.clarificationModel
      : "claude-haiku-5-5";

  const subAgent = await findAssistantSubAgent();
  if (!subAgent) {
    return NextResponse.json(
      { error: "No Assistant sub agent with email (SMTP) configured. Configure one in the Assistant settings." },
      { status: 503 },
    );
  }

  const initialSteps = [
    step("info", `Requesting information for "${submission.title}" in ${submission.publication.name}`),
    step("info", `Recipient: ${submitterEmail} (${submission.submitterName ?? "unknown"}) · sent by ${subAgent.name}`),
    latestReview
      ? step("info", `Using editorial review ${latestReview.id} for context`)
      : step("info", "No prior review found — drafting general clarification request"),
  ];
  if (missingElements.length || suggestions.length) {
    initialSteps.push(step("info", `Full review feedback shared with the Assistant: ${missingElements.length} missing element(s), ${suggestions.length} suggestion(s)`));
  }
  if (instructions) {
    initialSteps.push(step("info", `Custom instructions: ${instructions}`));
  }

  const task = await launchAgentTask({
    agentId: assistantAgent.id,
    label: `Info request · ${submission.submitterName ?? submitterEmail} · ${submission.title}`,
    subject: { type: "submission", id: submission.id },
    triggeredById: user.id,
    steps: initialSteps,
    // The conversation stays Ongoing until the submitter has sent what is needed (see clarification-reply)
    keepRunning: true,
    work: async ({ agentTaskId, log }) => {
      log("info", `Calling ${model} to write the information request`);

      const draft = await draftContributorEmail({
        apiKey,
        model,
        requiredLink: editUrl,
        prompt: `You are ${subAgent.name}${subAgent.soul ? ` (your persona: ${subAgent.soul})` : ""}. Write an email to ${submission.submitterName ? `the contributor ${submission.submitterName}` : "the contributor"} asking for the information the editorial team needs to publish their story in ${submission.publication.name}.

Their submission:
Title: ${submission.title}
Story type: ${submission.storyType ?? "unspecified"}
Story:
${submission.body}

${submissionDatesNote(submission.createdAt)}

${reviewFeedback ? `The editorial review of this submission (internal; do not quote scores or internal wording, translate it into friendly, concrete requests):\n${reviewFeedback}` : "There is no editorial review yet: read the story yourself and ask only for the essential details a local magazine editor could not get without them."}
${instructions ? `\nInstructions from the editorial team for this email (follow them):\n${instructions}\n` : ""}
${CONTRIBUTOR_ASK_POLICY}

Guidance:
- Show you actually read their story: mention something specific from it and what you liked (the review's strengths can help).
- Treat the review's missing elements and suggestions as input, not a checklist: keep only the essential ones that depend on the contributor, as a short numbered list (or a single sentence if there is just one).
- Mention briefly that they can reply to this email or edit the submission themselves at this link, which must appear on its own line exactly as written: ${editUrl}
- Warm, natural and brief (under 150 words), like a real person from the local publication team who cares about the story. No form-letter phrases.
- Plain text. Sign off with a short closing; the sender's name and signature are added automatically.`,
      });
      if (draft.revisedForLink) log("info", "First draft omitted the edit link — the model revised it");
      const emailBody = draft.body;
      const emailSubject = draft.subject;

      const { threadId, sentTo } = await sendSubAgentEmail({
        subAgentId: subAgent.id,
        taskId: agentTaskId,
        toEmail: submitterEmail,
        toName: submission.submitterName ?? undefined,
        subject: emailSubject,
        bodyText: emailBody,
      });
      await prisma.agentTask.update({ where: { id: agentTaskId }, data: { subAgentId: subAgent.id } });
      log("success", `Information request sent to ${sentTo} — waiting for the submitter's reply`);

      return {
        trigger: "submission",
        contentType: "clarification",
        referenceId: submission.id,
        referenceTitle: submission.title,
        emailTo: submitterEmail,
        emailSubject,
        bodyPreview: emailBody,
        editUrl,
        missingElements,
        reviewItems: [...missingElements, ...suggestions],
        reviewTaskId: latestReview?.id ?? null,
        instructions,
        status: "sent",
        threadId,
        sentTo,
        sentAt: new Date().toISOString(),
        followUpCount: 0,
      };
    },
  });

  return NextResponse.json({ task }, { status: 202 });
}

