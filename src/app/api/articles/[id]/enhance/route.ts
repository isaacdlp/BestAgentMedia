import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getArticleScope } from "@/lib/access";
import { launchAgentTask, step } from "@/lib/agent-task-runner";
import { ARTICLE_WORDS_PER_PAGE, countArticleWords, readArticleEnhanceRequest } from "@/lib/article-enhance";
import { getCurrentUser } from "@/lib/auth";
import { effortFor, MAX_OUTPUT_TOKENS } from "@/lib/claude-request";
import { prisma } from "@/lib/db";
import { EDITORIAL_GUIDANCE } from "@/lib/submission-agent-requests";
import { z } from "zod";

export const maxDuration = 300;

const RevisionSchema = z.object({
  title: z.string().describe("Revised headline (keep the current one if no change is warranted)."),
  body: z.string().describe("Revised full article body as rich-text Markdown."),
  changes: z.array(z.string()).describe("Short description of each change made."),
  unresolved: z.array(z.string()).describe("Gaps that could not be filled with the information available."),
});

/**
 * Launches a Copywriter Task that proposes a print-ready, formatted version of the article
 * (subheadings, emphasis, lists, quotes) at a target length in magazine pages. The article is not
 * changed: the task page shows the current and proposed versions side by side, and the proposal
 * is written only when a person accepts it (`/api/articles/[id]/enhance/[taskId]`).
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to enhance articles." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot edit articles." }, { status: 403 });
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

  const scope = await getArticleScope(user);
  const article = await prisma.article.findFirst({
    where: { id, ...scope },
    select: {
      id: true,
      title: true,
      body: true,
      styleName: true,
      business: { select: { name: true } },
      images: { orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { originalName: true } },
      issues: { select: { issue: { select: { name: true, publication: { select: { name: true } } } } } },
    },
  });
  if (!article) {
    return NextResponse.json({ error: "Article not found." }, { status: 404 });
  }

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "Enhancing is not configured (missing CLAUDE_KEY)." }, { status: 503 });
  }

  const { instructions, targetPages } = await readArticleEnhanceRequest(request);
  const targetWords = Math.round(targetPages * ARTICLE_WORDS_PER_PAGE);
  const currentWords = countArticleWords(article.body);

  const agentSettings = (agent.settings as Record<string, unknown>) ?? {};
  const model = typeof agentSettings.model === "string" ? agentSettings.model : "claude-sonnet-5-5";
  // Streamed, so a high ceiling is safe; thinking counts toward it and only generated tokens are billed
  const maxOutputTokens = Math.max(typeof agentSettings.maxOutputTokens === "number" ? agentSettings.maxOutputTokens : 0, MAX_OUTPUT_TOKENS);

  const publicationNames = [...new Set(article.issues.map(({ issue }) => issue.publication.name))].join(", ") || "unspecified";
  const initialSteps = [
    step("info", `Enhancing article "${article.title}" for print`),
    step("info", `Target length: ${formatPages(targetPages)} (about ${targetWords} words at ${ARTICLE_WORDS_PER_PAGE} words per page); currently ${currentWords} words`),
  ];
  if (instructions) {
    initialSteps.push(step("info", `Custom instructions: ${instructions}`));
  }

  const task = await launchAgentTask({
    agentId: agent.id,
    label: `Enhance · Article · ${article.title}`,
    subject: { type: "article", id: article.id },
    triggeredById: user.id,
    steps: initialSteps,
    work: async ({ log }) => {
      const details = [
        `Publication(s): ${publicationNames}`,
        `Issue(s): ${article.issues.map(({ issue }) => issue.name).join(", ") || "unassigned"}`,
        article.business ? `Related business: ${article.business.name}` : null,
        article.styleName ? `Paid promotion style: ${article.styleName} (a sponsored feature)` : null,
        `Photos that run with it: ${article.images.length ? article.images.map((image) => image.originalName).join(", ") : "none"}`,
      ].filter(Boolean).join("\n");

      log("info", `Calling ${model} to draft the enhanced article`);
      const client = new Anthropic({ apiKey });
      const message = await client.messages.stream({
        model,
        max_tokens: maxOutputTokens,
        output_config: { format: zodOutputFormat(RevisionSchema), ...effortFor(model, "medium") },
        system: `${EDITORIAL_GUIDANCE} You turn community articles into polished, print-ready magazine features: a strong headline, a clear structure with subheadings, tight paragraphs and well-chosen emphasis, at the length the layout needs. You never invent names, dates, quotes, numbers or other facts that are not in the article.`,
        messages: [
          {
            role: "user",
            content: `Enhance this article for a local community magazine.

${details}

Current title: ${article.title}

Current body (rich text as Markdown, ${currentWords} words):
${article.body}
${instructions ? `\nAdditional instructions from the editorial team (follow them):\n${instructions}\n` : ""}
Length:
- The article must fill ${formatPages(targetPages)} of the magazine: about ${targetWords} words of body text (stay within 10% of it), not counting the headline.
- ${targetWords < currentWords
  ? "Tighten it: cut repetition and minor detail first; keep the key facts, names and quotes."
  : "If the facts available cannot honestly fill that length, expand only with context and structure drawn from what the article says (never invented facts), and note the shortfall under \"unresolved\"."}

Formatting (the body is rich text, written as Markdown; use only these elements):
- "## " section subheadings and "### " minor subheadings; never a "# " heading (the title is set separately), and do not repeat the title in the body.
- Paragraphs separated by blank lines; **bold** for key names or facts and *italic* sparingly.
- "- " bullet lists or "1. " numbered lists for event details, schedules or steps, and "> " block quotes for a standout quote from the article.
- Links as [text](https://…) only for URLs that already appear in the article.
- No raw HTML tags, tables, images, code or horizontal rules.

Rules:
- Open with a lede that draws local readers in, and end with a clear close (what readers can do, where, when) when the article gives that information.
- Keep every fact as stated; if something important is missing, leave it out rather than inventing it, and list it under "unresolved".`,
          },
        ],
      }).finalMessage();
      log("info", `Response received — input: ${message.usage.input_tokens} tokens, output: ${message.usage.output_tokens} tokens`);

      const revision = message.parsed_output;
      if (!revision) {
        throw new Error(`The model returned no revision (stop reason: ${message.stop_reason}) — article left unchanged`);
      }
      const title = revision.title.trim() ? revision.title.trim().slice(0, 200) : article.title;
      const body = revision.body.trim().slice(0, 40_000);
      if (body.length < 50) {
        throw new Error("Model returned an empty or too-short body — article left unchanged");
      }

      const wordCount = countArticleWords(body);
      const changes = stringList(revision.changes);
      const unresolved = stringList(revision.unresolved);
      log("success", `Enhanced article ready — ${wordCount} words (target ${targetWords}), ${changes.length} change(s). The article is unchanged until the revision is accepted`);
      if (unresolved.length) {
        log("info", `Unresolved: ${unresolved.join("; ")}`);
      }

      return {
        contentType: "article-revision",
        referenceId: article.id,
        referenceTitle: title,
        instructions,
        targetPages,
        targetWords,
        wordCount,
        changes,
        unresolved,
        status: "pending_review",
        proposedTitle: title,
        proposedBody: body,
        previousTitle: article.title,
        previousBody: article.body,
      };
    },
  });

  return NextResponse.json({ task }, { status: 202 });
}

function formatPages(pages: number) {
  return `${pages} page${pages === 1 ? "" : "s"}`;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}
