import Anthropic from "@anthropic-ai/sdk";
import { AgentTaskStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSubmissionScope } from "@/lib/access";
import { launchAgentTask, step } from "@/lib/agent-task-runner";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export const maxDuration = 300;

export async function POST(
  _request: Request,
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

  // Find most recent editor review for context (missing elements, suggestions)
  const editorAgent = await prisma.agent.findUnique({
    where: { slug: "editor" },
    select: { id: true },
  });
  const latestReview = editorAgent
    ? await prisma.agentTask.findFirst({
        where: {
          agentId: editorAgent.id,
          status: AgentTaskStatus.SUCCEEDED,
          result: { path: ["referenceId"], equals: submission.id },
        },
        orderBy: { completedAt: "desc" },
        select: { id: true, result: true },
      })
    : null;

  const reviewResult = latestReview?.result as Record<string, unknown> | null;
  const missingElements: string[] = Array.isArray(reviewResult?.missingElements)
    ? (reviewResult.missingElements as string[])
    : [];
  const suggestions: string[] = Array.isArray(reviewResult?.suggestions)
    ? (reviewResult.suggestions as string[])
    : [];

  const appUrl = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const editUrl = `${appUrl}/submissions/${submission.id}`;

  const agentSettings = (assistantAgent.settings as Record<string, unknown>) ?? {};
  const model =
    typeof agentSettings.clarificationModel === "string"
      ? agentSettings.clarificationModel
      : "claude-haiku-5-5";

  const initialSteps = [
    step("info", `Drafting clarification email for "${submission.title}" in ${submission.publication.name}`),
    step("info", `Recipient: ${submitterEmail} (${submission.submitterName ?? "unknown"})`),
    latestReview
      ? step("info", `Using editorial review ${latestReview.id} for context`)
      : step("info", "No prior review found — drafting general clarification request"),
  ];
  if (missingElements.length || suggestions.length) {
    initialSteps.push(step("info", `Review items: ${missingElements.length} missing element(s), ${suggestions.length} suggestion(s) — all included in email`));
  }

  const task = await launchAgentTask({
    agentId: assistantAgent.id,
    label: `Info request · ${submission.submitterName ?? submitterEmail} · ${submission.title}`,
    triggeredById: user.id,
    steps: initialSteps,
    work: async ({ log }) => {
      const allItems = [
        ...missingElements.map((e) => `- Missing: ${e}`),
        ...suggestions.map((s) => `- Suggestion: ${s}`),
      ];
      const editorContext =
        allItems.length
          ? `\n\nThe editorial team flagged the following items — include every single one in the email, listed clearly:\n${allItems.join("\n")}`
          : "";

      log("info", `Calling ${model} to draft clarification email`);

      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model,
        max_tokens: 800,
        system: `You are a warm and supportive community publication assistant who has an ongoing relationship with local story contributors. You write personal, encouraging emails that feel genuinely human. You never sound robotic or form-letter. Keep it brief, friendly, and actionable.`,
        messages: [
          {
            role: "user",
            content: `Draft a clarification email to a contributor named "${submission.submitterName ?? "there"}" about their story submission titled "${submission.title}" for ${submission.publication.name}.${editorContext}

The email must:
1. Warmly acknowledge their submission and express genuine interest in their story
2. List EVERY flagged item from above as a numbered list — do not summarise, omit, or combine any of them; if nothing was flagged, ask for a bit more detail in general
3. After the list, explain they have two options:
   a) Click the link below to edit the submission directly
   b) Simply reply to this email with the requested information or photos
4. Show the edit link on its own line, exactly as: ${editUrl}
5. Keep the tone conversational and human — under 220 words total
6. Sound like it comes from a real person who cares, not an automated system

Return ONLY the email body text (no subject line). Start directly with the greeting.`,
          },
        ],
      });

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Model returned no text content");
      }

      const generatedBody = textBlock.text.trim();
      // Force the link into the body — append a standardized footer if the model omitted it
      const linkFooter = `\n\nEdit your submission directly:\n${editUrl}\n\nOr simply reply to this email with the information or photos — we'll add them for you.`;
      const emailBody = generatedBody.includes(editUrl) ? generatedBody : generatedBody + linkFooter;
      const emailSubject = `Quick follow-up on your story: "${submission.title}"`;

      log("success", "Clarification email drafted — queued for review, not sent yet");

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
        reviewItems: allItems.map((item) => item.replace(/^- (Missing|Suggestion): /, "")),
        reviewTaskId: latestReview?.id ?? null,
        status: "draft",
      };
    },
  });

  return NextResponse.json({ task }, { status: 202 });
}
