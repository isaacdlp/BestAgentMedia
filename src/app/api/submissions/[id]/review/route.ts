import Anthropic from "@anthropic-ai/sdk";
import { SubmissionStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getSubmissionScope } from "@/lib/access";
import { launchAgentTask, step } from "@/lib/agent-task-runner";
import { getCurrentUser } from "@/lib/auth";
import { MAX_OUTPUT_TOKENS } from "@/lib/claude-request";
import { prisma } from "@/lib/db";
import { EDITORIAL_GUIDANCE, formatReceivedInfo, getSubmissionReceivedInfo, submissionReviewsWhere } from "@/lib/submission-agent-requests";

export const maxDuration = 300;

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to request an editorial review." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot request editorial reviews." }, { status: 403 });
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

  const agentSettings = (agent.settings as Record<string, unknown>) ?? {};
  const model = typeof agentSettings.model === "string" ? agentSettings.model : "claude-sonnet-5-5";
  // Streamed, so a high ceiling is safe; thinking counts toward it and only generated tokens are billed
  const maxOutputTokens = Math.max(typeof agentSettings.maxOutputTokens === "number" ? agentSettings.maxOutputTokens : 0, MAX_OUTPUT_TOKENS);

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
      publication: { select: { name: true } },
    },
  });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Editorial review is not configured (missing CLAUDE_KEY)." }, { status: 503 });
  }

  // A review moves a draft submission into review as soon as it starts
  await prisma.contentSubmission.updateMany({
    where: { id: submission.id, status: SubmissionStatus.DRAFT },
    data: { status: SubmissionStatus.IN_REVIEW },
  });

  const task = await launchAgentTask({
    agentId: agent.id,
    label: `Editorial review · Submission · ${submission.title}`,
    subject: { type: "submission", id: submission.id },
    triggeredById: user.id,
    steps: [
      step("info", `Starting editorial review for submission "${submission.title}" in ${submission.publication.name}`),
      step("info", `Agent settings: model=${model}, maxOutputTokens=${maxOutputTokens}`),
      step("info", `Submission: "${submission.title}" · type: ${submission.storyType ?? "unspecified"} · publication: ${submission.publication.name}`),
    ],
    work: async ({ agentTaskId, log }) => {
      // Check for a prior review so we can compute a delta
      const previousReview = await prisma.agentTask.findFirst({
        where: { ...submissionReviewsWhere(agent.id, submission.id), id: { not: agentTaskId } },
        orderBy: { completedAt: "desc" },
        select: { id: true, result: true },
      });

      // Information the submitter sent on info requests; it is not in the body until the Copywriter applies it
      const receivedInfo = formatReceivedInfo(await getSubmissionReceivedInfo(submission.id));
      if (receivedInfo) log("info", "Including information received from the submitter on info requests");

      log("info", `Calling ${model} for editorial analysis`);
      const client = new Anthropic({ apiKey });
      const message = await client.messages.stream({
        model,
        max_tokens: maxOutputTokens,
        system: `${EDITORIAL_GUIDANCE} Review content submissions and return structured editorial feedback as JSON.`,
        messages: [
          {
            role: "user",
            content: `Review this community story submission and return a JSON object with editorial feedback.

Publication: ${submission.publication.name}
Story type: ${submission.storyType ?? "unspecified"}
Title: ${submission.title}

Body:
${submission.body}
${receivedInfo ? `
Information the contributor has since sent by email (not in the body yet; the editors will work it in). Do not list anything answered here as missing; suggest where it should go instead:
${receivedInfo}
` : ""}
Return ONLY a valid JSON object — no markdown, no explanation, no code fences:

{
  "headlineSuggestion": "An improved or alternative headline (string, or null if the original is strong)",
  "summary": "2-3 sentence editorial assessment of the submission's overall quality and fit",
  "strengths": ["strength 1", "strength 2"],
  "suggestions": ["specific improvement 1", "specific improvement 2", "specific improvement 3"],
  "missingElements": ["what is missing or unclear, if anything"],
  "readabilityScore": <integer 1-10>,
  "communityRelevanceScore": <integer 1-10>
}`,
          },
        ],
      }).finalMessage();

      const inputTokens = message.usage.input_tokens;
      const outputTokens = message.usage.output_tokens;
      log("info", `Response received — input: ${inputTokens} tokens, output: ${outputTokens} tokens`);

      const textBlock = message.content.find((b) => b.type === "text");
      if (!textBlock || textBlock.type !== "text") {
        throw new Error("Model returned no text content");
      }

      let raw = textBlock.text.trim();
      if (raw.startsWith("```")) {
        raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
      }
      const feedback = JSON.parse(raw) as Record<string, unknown>;
      log("success", `Editorial review complete — readability: ${feedback.readabilityScore ?? "?"}/10, community relevance: ${feedback.communityRelevanceScore ?? "?"}/10`);

      // Compute delta against the previous review (if any)
      const prevResult = previousReview?.result as Record<string, unknown> | null;
      const prevReadability = typeof prevResult?.readabilityScore === "number" ? prevResult.readabilityScore : null;
      const prevCommunityRelevance = typeof prevResult?.communityRelevanceScore === "number" ? prevResult.communityRelevanceScore : null;
      const prevMissing: string[] = Array.isArray(prevResult?.missingElements) ? (prevResult.missingElements as string[]) : [];
      const newMissing: string[] = Array.isArray(feedback.missingElements) ? (feedback.missingElements as string[]) : [];
      const resolvedElements = prevMissing.filter((p) => !newMissing.some((n) => n.toLowerCase().includes(p.toLowerCase().slice(0, 20))));
      const newConcerns = newMissing.filter((n) => !prevMissing.some((p) => p.toLowerCase().includes(n.toLowerCase().slice(0, 20))));

      if (previousReview) {
        log("info", `Delta vs previous review: readability ${prevReadability ?? "?"} → ${feedback.readabilityScore ?? "?"}, community relevance ${prevCommunityRelevance ?? "?"} → ${feedback.communityRelevanceScore ?? "?"}`);
      }

      return {
        contentType: "submission",
        referenceId: submission.id,
        referenceTitle: submission.title,
        headlineSuggestion: feedback.headlineSuggestion ?? null,
        summary: feedback.summary ?? null,
        strengths: feedback.strengths ?? [],
        suggestions: feedback.suggestions ?? [],
        missingElements: feedback.missingElements ?? [],
        readabilityScore: feedback.readabilityScore ?? null,
        communityRelevanceScore: feedback.communityRelevanceScore ?? null,
        inputTokens,
        outputTokens,
        // Delta (only present on re-reviews)
        ...(previousReview ? {
          previousReviewId: previousReview.id,
          deltaReadability: prevReadability !== null && feedback.readabilityScore != null ? (feedback.readabilityScore as number) - prevReadability : null,
          deltaCommunityRelevance: prevCommunityRelevance !== null && feedback.communityRelevanceScore != null ? (feedback.communityRelevanceScore as number) - prevCommunityRelevance : null,
          resolvedElements,
          newConcerns,
        } : {}),
      };
    },
  });

  return NextResponse.json({ task }, { status: 202 });
}
