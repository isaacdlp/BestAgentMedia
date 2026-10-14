import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { AgentTaskStatus, Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getArticleScope, getIssueScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type TaskStep = { at: string; level: "info" | "success" | "error"; message: string };

function step(level: TaskStep["level"], message: string): TaskStep {
  return { at: new Date().toISOString(), level, message };
}

const VALID_ELEMENT_TYPES = new Set(["text", "image", "svg", "figure", "video", "line", "group"]);
function sanitizeDesign(design: Record<string, unknown>): Record<string, unknown> {
  const pages = Array.isArray(design.pages) ? design.pages : [];
  return {
    ...design,
    pages: (pages as Record<string, unknown>[]).map((page) => ({
      ...page,
      children: Array.isArray(page.children)
        ? (page.children as unknown[]).filter((el) => {
            if (typeof el !== "object" || el === null) return false;
            const t = (el as Record<string, unknown>).type;
            return typeof t === "string" && VALID_ELEMENT_TYPES.has(t);
          })
        : [],
    })),
  };
}

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to generate a layout." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    return NextResponse.json({ error: "You cannot generate issue layouts." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  const issueScope = await getIssueScope(user);
  if (!issueScope) {
    return NextResponse.json({ error: "You cannot generate issue layouts." }, { status: 403 });
  }

  // Check the Designer agent is enabled
  const agent = await prisma.agent.findUnique({
    where: { slug: "designer" },
    select: { id: true, enabled: true, settings: true },
  });
  if (!agent) {
    return NextResponse.json({ error: "Designer agent is not configured. Run the database seed." }, { status: 503 });
  }
  if (!agent.enabled) {
    return NextResponse.json({ error: "The Designer agent is currently disabled. Enable it in the Agents section." }, { status: 503 });
  }

  const agentSettings = (agent.settings as Record<string, unknown>) ?? {};
  const model = typeof agentSettings.model === "string" ? agentSettings.model : "claude-opus-4-8";
  const maxOutputTokens = typeof agentSettings.maxOutputTokens === "number" ? agentSettings.maxOutputTokens : 12000;

  const issue = await prisma.issue.findFirst({
    where: { id, ...issueScope },
    select: {
      id: true,
      publicationId: true,
      publicationDate: true,
      publication: { select: { id: true, name: true, coverImagePath: true } },
      pages: {
        orderBy: { pageNumber: "asc" },
        select: { id: true, pageNumber: true, type: true },
      },
    },
  });
  if (!issue) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  const apiKey = process.env.CLAUDE_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "AI layout generation is not configured (missing CLAUDE_KEY)." }, { status: 503 });
  }

  // Create the task record
  const task = await prisma.agentTask.create({
    data: {
      agentId: agent.id,
      status: AgentTaskStatus.RUNNING,
      label: `Generate layout · ${issue.publication.name} · ${issue.publicationDate.toISOString().slice(0, 7)}`,
      issueId: issue.id,
      triggeredById: user.id,
      startedAt: new Date(),
      steps: [step("info", `Starting: Generate layout for "${issue.publication.name}" (${issue.publicationDate.toISOString().slice(0, 10)})`)] as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  const steps: TaskStep[] = [
    step("info", `Agent settings: model=${model}, maxOutputTokens=${maxOutputTokens}`),
  ];

  // Fetch articles and ads
  const articleScope = await getArticleScope(user);
  const [articles, advertisements] = await Promise.all([
    prisma.article.findMany({
      where: {
        AND: [
          articleScope,
          { publications: { some: { publicationId: issue.publicationId } } },
        ],
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        body: true,
        images: { orderBy: { position: "asc" }, select: { id: true } },
      },
    }),
    prisma.advertisement.findMany({
      where: {
        publications: { some: { publicationId: issue.publicationId } },
        status: { not: "DECLINED" },
      },
      orderBy: { title: "asc" },
      select: { id: true, title: true, business: { select: { name: true } } },
    }),
  ]);
  steps.push(step("info", `Fetched ${articles.length} article(s) and ${advertisements.length} advertisement(s) for "${issue.publication.name}"`));

  // Load publication cover image
  let coverImageBase64: string | null = null;
  let coverMimeType: "image/png" | "image/jpeg" = "image/jpeg";
  const coverPath = issue.publication.coverImagePath;
  if (coverPath) {
    const filename = coverPath.match(/^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i)?.[1];
    if (filename) {
      try {
        const imageBuffer = await readFile(resolve(process.cwd(), "media", "publications", filename));
        coverImageBase64 = imageBuffer.toString("base64");
        coverMimeType = filename.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
        steps.push(step("info", `Loaded cover image "${filename}" (${Math.round(imageBuffer.byteLength / 1024)} KB) for visual style guidance`));
      } catch {
        steps.push(step("info", "Cover image file not found on disk — proceeding without visual style reference"));
      }
    } else {
      steps.push(step("info", "Cover image path format unrecognised — proceeding without visual style reference"));
    }
  } else {
    steps.push(step("info", "No cover image configured for this publication"));
  }

  // Build AI prompt
  const pages = issue.pages.map((p) => ({ id: p.id, type: p.type, number: p.pageNumber }));
  const articleData = articles.map((a) => ({
    id: a.id,
    title: a.title,
    bodyPreview: a.body.slice(0, 300),
    imageUrl: a.images[0] ? `/api/articles/${a.id}/images/${a.images[0].id}` : null,
  }));
  const adData = advertisements.map((ad) => ({
    id: ad.id,
    title: ad.title,
    businessName: ad.business.name,
  }));

  const userContent: Anthropic.MessageParam["content"] = [];
  if (coverImageBase64) {
    userContent.push({ type: "text", text: `Here is the cover of "${issue.publication.name}" for visual style reference:` });
    userContent.push({ type: "image", source: { type: "base64", media_type: coverMimeType, data: coverImageBase64 } });
  }
  userContent.push({
    type: "text",
    text: `Generate a professional Polotno layout design for a "${issue.publication.name}" issue (date: ${issue.publicationDate.toISOString().slice(0, 10)}).

Pages (use EXACT ids):
${JSON.stringify(pages, null, 2)}

Articles:
${JSON.stringify(articleData, null, 2)}

Advertisements:
${JSON.stringify(adData, null, 2)}

Return ONLY a valid JSON object — no markdown, no explanation, no code fences.

IMPORTANT — valid Polotno page structure:
{
  "width": 816,
  "height": 1056,
  "pages": [
    {
      "id": "<EXACT id from pages list>",
      "background": "#hexcolor",
      "children": [ /* only text and image elements — NO other types */ ],
      "custom": { "bestAgentMedia": { "issuePageId": "<id>", "pageType": "<COVER|INNER|BACK_COVER>" } }
    }
  ]
}

ONLY TWO element types exist. Do NOT use "rect", "shape", "circle", "line", or any other type.

Text element:
{
  "id": "unique-string",
  "type": "text",
  "text": "content here",
  "x": N, "y": N, "width": N, "height": N,
  "fontSize": N,
  "fontWeight": "bold" | "normal",
  "fontStyle": "normal" | "italic",
  "fill": "#hexcolor",
  "align": "left" | "center" | "right",
  "custom": { "bestAgentMedia": { "sourceType": "article", "sourceId": "<article id>" } }
}

Image element:
{
  "id": "unique-string",
  "type": "image",
  "src": "<full imageUrl from articles data>",
  "x": N, "y": N, "width": N, "height": N,
  "custom": { "bestAgentMedia": { "sourceType": "article", "sourceId": "<article id>" } }
}

For advertisements use "sourceType": "advertisement" and "sourceId": "<ad id>".
Elements without a content link (decorative text, labels) omit the custom.bestAgentMedia entirely.

Layout rules:
1. Use EXACT page IDs provided — do NOT invent new ones
2. Set "background" on each page to a rich, publication-appropriate colour (use palette from cover image)
3. Unique element IDs: "cover-pub-name", "cover-headline", "p2-img", "p2-title", "p2-body", etc.
4. Cover: publication name (large bold), main story headline, issue date
5. Inner pages: one article per page — headline (bold 28-40px), body excerpt (13-15px), image if available
6. Advertisements: place each ad on its own page or as a half-page block (title + business name as styled text)
7. Back cover: featured ad or publication contact info
8. All coordinates within 0–816 (x) and 0–1056 (y); text margins ≥ 40px from page edges
9. Titles 28-48px bold, subheads 18-24px, body 13-16px, use light text on dark backgrounds
10. Return ONLY the JSON — nothing else`,
  });

  steps.push(step("info", `Calling ${model} with adaptive thinking (maxOutputTokens: ${maxOutputTokens})`));

  const client = new Anthropic({ apiKey });
  let design: unknown;
  let inputTokens = 0;
  let outputTokens = 0;
  let thinkingTokens = 0;

  try {
    const stream = await client.messages.stream({
      model,
      max_tokens: maxOutputTokens,
      thinking: { type: "adaptive" },
      system: "You are a professional publication layout designer generating Polotno canvas JSON. Return ONLY valid JSON — no markdown code fences, no explanation. Page backgrounds use the \"background\" property. Child elements use ONLY type \"text\" or type \"image\" — never \"rect\", \"shape\", \"circle\", \"figure\", \"line\", or any other type.",
      messages: [{ role: "user", content: userContent }],
    });
    const message = await stream.finalMessage();

    inputTokens = message.usage.input_tokens;
    outputTokens = message.usage.output_tokens;
    const thinkingBlock = message.content.find((b) => b.type === "thinking");
    if (thinkingBlock && thinkingBlock.type === "thinking") {
      thinkingTokens = thinkingBlock.thinking?.length ?? 0;
    }
    steps.push(step("info", `Response received — input: ${inputTokens} tokens, output: ${outputTokens} tokens`));

    const textBlock = message.content.find((b) => b.type === "text");
    if (!textBlock || textBlock.type !== "text") {
      throw new Error("Model returned no text content");
    }

    let raw = textBlock.text.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```\s*$/, "");
    }
    design = sanitizeDesign(JSON.parse(raw) as Record<string, unknown>);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    steps.push(step("error", `Generation failed: ${message}`));
    await prisma.agentTask.update({
      where: { id: task.id },
      data: {
        status: AgentTaskStatus.FAILED,
        error: message,
        completedAt: new Date(),
        steps: steps as unknown as Prisma.InputJsonValue,
      },
    });
    return NextResponse.json({ error: `Layout generation failed: ${message}`, taskId: task.id }, { status: 502 });
  }

  // Count elements across all pages
  const designPages = Array.isArray((design as Record<string, unknown>).pages)
    ? ((design as Record<string, unknown>).pages as unknown[])
    : [];
  const pageCount = designPages.length;
  const elementCount = designPages.reduce<number>((sum, p) => {
    const children = (p as Record<string, unknown>).children;
    return sum + (Array.isArray(children) ? children.length : 0);
  }, 0);

  steps.push(step("success", `Layout generated: ${pageCount} pages, ${elementCount} elements total (thinking: ${thinkingTokens} chars)`));

  // Auto-save the design to the issue so it is not lost if the user navigates away
  await prisma.issue.update({
    where: { id: issue.id },
    data: { designJson: design as Prisma.InputJsonValue },
  });
  steps.push(step("info", "Design saved to issue draft"));

  await prisma.agentTask.update({
    where: { id: task.id },
    data: {
      status: AgentTaskStatus.SUCCEEDED,
      completedAt: new Date(),
      steps: steps as unknown as Prisma.InputJsonValue,
      // Store the design so it can be redeployed from the Agents page
      result: { pageCount, elementCount, inputTokens, outputTokens, thinkingTokens, design } as unknown as Prisma.InputJsonValue,
    },
  });

  return NextResponse.json({ design, taskId: task.id });
}
