import Anthropic from "@anthropic-ai/sdk";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getArticleScope } from "@/lib/access";
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
    return NextResponse.json({ error: "Sign in to request an editorial review." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot request editorial reviews." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Article not found." }, { status: 404 });
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
  const model = typeof agentSettings.model === "string" ? agentSettings.model : "claude-sonnet-4-5";
  const maxOutputTokens = typeof agentSettings.maxOutputTokens === "number" ? agentSettings.maxOutputTokens : 4000;

  const scope = await getArticleScope(user);
  const article = await prisma.article.findFirst({
    where: { id, ...scope },
    select: {
      id: true,
      title: true,
      body: true,
      status: true,
      publications: {
        select: { publication: { select: { name: true } } },
      },
    },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found." }, { status: 404 });
  }

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Editorial review is not configured (missing CLAUDE_KEY)." }, { status: 503 });
  }

  const publicationNames = article.publications.map((p) => p.publication.name).join(", ") || "unspecified";

  const task = await launchAgentTask({
    agentId: agent.id,
    label: `Editorial review · Article · ${article.title}`,
    triggeredById: user.id,
    steps: [
      step("info", `Starting editorial review for article "${article.title}"`),
      step("info", `Agent settings: model=${model}, maxOutputTokens=${maxOutputTokens}`),
      step("info", `Article: "${article.title}" · status: ${article.status} · publication(s): ${publicationNames}`),
    ],
    work: async ({ log }) => {
      log("info", `Calling ${model} for editorial analysis`);
      const client = new Anthropic({ apiKey });
      const message = await client.messages.create({
        model,
        max_tokens: maxOutputTokens,
        system: `You are an experienced editor for a local community publication. Review articles and return structured editorial feedback as JSON. Be constructive, specific, and practical. Focus on publication-ready quality.`,
        messages: [
          {
            role: "user",
            content: `Review this community publication article and return a JSON object with editorial feedback.

Publication(s): ${publicationNames}
Title: ${article.title}

Body:
${article.body}

Return ONLY a valid JSON object — no markdown, no explanation, no code fences:

{
  "headlineSuggestion": "An improved or alternative headline (string, or null if the original is strong)",
  "summary": "2-3 sentence editorial assessment of the article's overall quality and publication-readiness",
  "strengths": ["strength 1", "strength 2"],
  "suggestions": ["specific improvement 1", "specific improvement 2", "specific improvement 3"],
  "missingElements": ["what is missing or unclear, if anything"],
  "readabilityScore": <integer 1-10>,
  "communityRelevanceScore": <integer 1-10>
}`,
          },
        ],
      });

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

      return {
        contentType: "article",
        referenceId: article.id,
        referenceTitle: article.title,
        headlineSuggestion: feedback.headlineSuggestion ?? null,
        summary: feedback.summary ?? null,
        strengths: feedback.strengths ?? [],
        suggestions: feedback.suggestions ?? [],
        missingElements: feedback.missingElements ?? [],
        readabilityScore: feedback.readabilityScore ?? null,
        communityRelevanceScore: feedback.communityRelevanceScore ?? null,
        inputTokens,
        outputTokens,
      };
    },
  });

  return NextResponse.json({ task }, { status: 202 });
}
