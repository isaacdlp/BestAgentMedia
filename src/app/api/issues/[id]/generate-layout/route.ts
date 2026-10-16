import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getArticleScope, getIssueScope } from "@/lib/access";
import { DEFAULT_AD_PRINT_SPEC, resolveAdPrintSpec } from "@/lib/ad-print-specs";
import { launchAgentTask, step } from "@/lib/agent-task-runner";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { composeIssueLayout, readComposerSettings } from "@/lib/designer-composer";
import type { AdSize, CompositionAd, CompositionArticle } from "@/lib/issue-composition";

export const maxDuration = 800;

const MAX_INSTRUCTIONS = 2000;

/**
 * Launches a Designer task that composes the whole issue: cover, as many inner pages as the
 * content needs and back cover, using every article and ad assigned to the issue. The result is
 * stored on the task for review; it is applied to the issue only when a person chooses
 * "Apply to issue" on the task page.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to generate a layout." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot generate issue layouts." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  let instructions = "";
  try {
    const body = (await request.json()) as { instructions?: unknown };
    if (typeof body.instructions === "string") instructions = body.instructions.trim();
  } catch {
    // No body: no custom instructions.
  }
  if (instructions.length > MAX_INSTRUCTIONS) {
    return NextResponse.json({ error: `Custom instructions cannot exceed ${MAX_INSTRUCTIONS} characters.` }, { status: 400 });
  }

  const issueScope = await getIssueScope(user);
  if (!issueScope) {
    return NextResponse.json({ error: "You cannot generate issue layouts." }, { status: 403 });
  }

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
  const settings = readComposerSettings((agent.settings as Record<string, unknown>) ?? {});

  const issue = await prisma.issue.findFirst({
    where: { id, ...issueScope },
    select: {
      id: true,
      name: true,
      description: true,
      publicationDate: true,
      publication: {
        select: { name: true, coverImagePath: true, zipCodes: { select: { code: true }, orderBy: { code: "asc" } } },
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

  // Every article and ad assigned to the issue (declined ads excluded), matching what the
  // design endpoint accepts as linkable content.
  const articleScope = await getArticleScope(user);
  const [articles, advertisements] = await Promise.all([
    prisma.article.findMany({
      where: { AND: [articleScope, { issues: { some: { issueId: issue.id } } }] },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        body: true,
        status: true,
        styleName: true,
        promotionPackage: { select: { name: true } },
        business: { select: { name: true } },
        images: { orderBy: { position: "asc" }, select: { id: true, fileName: true } },
      },
    }),
    prisma.advertisement.findMany({
      where: { issues: { some: { issueId: issue.id } }, status: { not: "DECLINED" } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        title: true,
        status: true,
        styleName: true,
        creativeFileName: true,
        promotionPackage: { select: { name: true, description: true } },
        business: { select: { name: true } },
      },
    }),
  ]);
  if (!articles.length && !advertisements.length) {
    return NextResponse.json({ error: "Assign articles or ads to this issue before composing its layout." }, { status: 409 });
  }

  const compositionArticles: CompositionArticle[] = articles.map((article) => ({
    id: article.id,
    title: article.title,
    body: article.body,
    status: article.status,
    imageUrls: article.images.map((image) => `/api/articles/${article.id}/images/${image.id}`),
    sponsoredStyle: article.promotionPackage?.name ?? article.styleName ?? null,
    businessName: article.business?.name ?? null,
  }));
  const compositionAds: CompositionAd[] = advertisements.map((ad) => {
    const spec = resolveAdPrintSpec(ad.promotionPackage?.name ?? ad.styleName, ad.promotionPackage?.description) ?? DEFAULT_AD_PRINT_SPEC;
    return {
      id: ad.id,
      title: ad.title,
      businessName: ad.business.name,
      status: ad.status,
      size: (spec.key === "custom" ? "half" : spec.key) as AdSize,
      sizeLabel: spec.label,
      imageUrl: ad.creativeFileName ? `/api/ads/${ad.id}/creative` : null,
    };
  });

  const task = await launchAgentTask({
    agentId: agent.id,
    label: `Compose layout · ${issue.name}`,
    triggeredById: user.id,
    issueId: issue.id,
    steps: [
      step("info", `Starting: compose "${issue.name}" of ${issue.publication.name} (${issue.publicationDate.toISOString().slice(0, 10)})`),
      step("info", `${articles.length} article(s) and ${advertisements.length} ad(s) to place${instructions ? "; with custom instructions" : ""}`),
    ],
    work: ({ log }) =>
      composeIssueLayout({
        publication: {
          name: issue.publication.name,
          zipCodes: issue.publication.zipCodes.map((zip) => zip.code),
          coverImagePath: issue.publication.coverImagePath,
        },
        issue: { name: issue.name, description: issue.description, publicationDate: issue.publicationDate },
        context: {
          articles: compositionArticles,
          ads: compositionAds,
          issueInfo: { publicationName: issue.publication.name, publicationDate: issue.publicationDate.toISOString() },
        },
        articlePhotoFiles: new Map(articles.map((article) => [article.id, article.images.map((image) => image.fileName)])),
        instructions,
        apiKey,
        settings,
        log,
      }),
  });

  return NextResponse.json({ task }, { status: 202 });
}
