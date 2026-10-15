import { AdvertisementStatus, Prisma, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getArticleScope, getIssueScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { CESDK_DESIGN_FORMAT } from "@/lib/issue-design";

const maximumDesignBytes = 5 * 1024 * 1024;

const issuePageSchema = z.object({
  id: z.string().regex(/^[\w-]{1,64}$/),
  children: z.array(z.unknown()).max(2500),
  custom: z.unknown().optional(),
}).passthrough();

// The editor saves a CreativeEditor (CE.SDK) document: the serialized scene plus a page
// manifest of page IDs and linked content (see src/lib/issue-design.ts).
const designSchema = z
  .object({
    format: z.literal(CESDK_DESIGN_FORMAT),
    version: z.literal(1),
    width: z.number().finite().positive().max(10000),
    height: z.number().finite().positive().max(10000),
    scene: z.string().min(1).max(maximumDesignBytes),
    pages: z.array(issuePageSchema).min(2).max(200),
  })
  .strict();

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to edit this issue." }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot edit issue layouts." }, { status: 403 });
  }
  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumDesignBytes) {
    return NextResponse.json({ error: "The issue design cannot exceed 5 MB." }, { status: 413 });
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return NextResponse.json({ error: "Provide a valid issue design." }, { status: 400 });
  }
  const parsed = designSchema.safeParse(input);
  if (
    !parsed.success ||
    Buffer.byteLength(JSON.stringify(input), "utf8") > maximumDesignBytes
  ) {
    return NextResponse.json({ error: "The issue design is invalid or too large." }, { status: 400 });
  }
  if (parsed.data.pages.length < 3) {
    return NextResponse.json({
      error: "An issue must have a cover, at least one inner page, and a back cover.",
    }, { status: 400 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }
  const issueScope = await getIssueScope(user);
  if (!issueScope) {
    return NextResponse.json({ error: "You cannot edit issue layouts." }, { status: 403 });
  }
  const issue = await prisma.issue.findFirst({
    where: { id, ...issueScope },
    select: {
      id: true,
      publicationId: true,
      pages: { select: { id: true, type: true } },
    },
  });
  if (!issue) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  const pages = parsed.data.pages;
  if (new Set(pages.map(({ id: pageId }) => pageId)).size !== pages.length) {
    return NextResponse.json({ error: "Every issue page must have a unique page ID." }, { status: 400 });
  }
  const requestedPageIds = pages.map(({ id: pageId }) => pageId);
  const pageIdsOwnedElsewhere = await prisma.issuePage.findMany({
    where: {
      id: { in: requestedPageIds },
      issueId: { not: issue.id },
    },
    select: { id: true },
  });
  if (pageIdsOwnedElsewhere.length) {
    return NextResponse.json({ error: "A page ID belongs to another issue." }, { status: 400 });
  }
  const storedPageTypes = new Map(issue.pages.map(({ id: pageId, type }) => [pageId, type]));
  const pageTypes = pages.map((page, index) => {
    const storedType = storedPageTypes.get(page.id);
    return storedType ?? (index === 0 ? "COVER" : index === pages.length - 1 ? "BACK_COVER" : "INNER");
  });
  if (
    pageTypes[0] !== "COVER" ||
    pageTypes[pageTypes.length - 1] !== "BACK_COVER" ||
    pageTypes.slice(1, -1).some((type) => type !== "INNER")
  ) {
    return NextResponse.json({
      error: "Keep the cover first and the back cover last. Inner pages can be rearranged between them.",
    }, { status: 400 });
  }
  if (issue.pages.some(({ id: pageId, type }) => type !== "INNER" && !pages.some(({ id: savedId }) => savedId === pageId))) {
    return NextResponse.json({ error: "The cover and back cover cannot be deleted." }, { status: 400 });
  }

  let linkedElements: LinkedElement[];
  try {
    linkedElements = pages.flatMap((page) =>
      collectLinkedElements(page.children, page.id),
    );
  } catch (error) {
    return NextResponse.json({
      error: error instanceof Error ? error.message : "The issue contains invalid content links.",
    }, { status: 400 });
  }
  const articleIds = [...new Set(linkedElements.flatMap(({ articleId }) => articleId ? [articleId] : []))];
  const advertisementIds = [...new Set(linkedElements.flatMap(({ advertisementId }) => advertisementId ? [advertisementId] : []))];

  const articleScope = await getArticleScope(user);
  const [articles, advertisements] = await Promise.all([
    articleIds.length
      ? prisma.article.findMany({
          where: {
            id: { in: articleIds },
            AND: [
              articleScope,
              { issues: { some: { issueId: issue.id } } },
            ],
          },
          select: { id: true },
        })
      : Promise.resolve([]),
    advertisementIds.length
      ? prisma.advertisement.findMany({
          where: {
            id: { in: advertisementIds },
            issues: { some: { issueId: issue.id } },
            status: { not: AdvertisementStatus.DECLINED },
          },
          select: { id: true },
        })
      : Promise.resolve([]),
  ]);
  if (articles.length !== articleIds.length || advertisements.length !== advertisementIds.length) {
    return NextResponse.json({
      error: "The design contains content that is not available to this publication.",
    }, { status: 403 });
  }

  const pageIds = new Set(pages.map(({ id: pageId }) => pageId));
  await prisma.$transaction(async (transaction) => {
    await transaction.issue.update({
      where: { id: issue.id },
      data: { designJson: parsed.data as Prisma.InputJsonValue },
    });
    await transaction.$executeRaw`
      UPDATE "IssuePage"
      SET "pageNumber" = -"pageNumber"
      WHERE "issueId" = ${issue.id}
    `;
    await transaction.issuePage.deleteMany({
      where: {
        issueId: issue.id,
        type: "INNER",
        id: { notIn: [...pageIds] },
      },
    });
    for (const [index, page] of pages.entries()) {
      const type = pageTypes[index] as "COVER" | "INNER" | "BACK_COVER";
      if (storedPageTypes.has(page.id)) {
        await transaction.issuePage.update({
          where: { id: page.id },
          data: { pageNumber: index + 1, type },
        });
      } else {
        await transaction.issuePage.create({
          data: {
            id: page.id,
            issueId: issue.id,
            pageNumber: index + 1,
            type,
          },
        });
      }
    }
    await transaction.issuePagePlacement.deleteMany({
      where: { page: { issueId: issue.id } },
    });
    if (linkedElements.length) {
      await transaction.issuePagePlacement.createMany({
        data: linkedElements.map((element) => ({
          pageId: element.pageId,
          elementId: element.elementId,
          articleId: element.articleId,
          advertisementId: element.advertisementId,
        })),
      });
    }
  });

  revalidatePath(`/issues/${issue.id}`);
  revalidatePath("/articles");
  return NextResponse.json({ message: "Issue layout saved." });
}

type LinkedElement = {
  pageId: string;
  elementId: string;
  articleId: string | null;
  advertisementId: string | null;
};

function collectLinkedElements(
  children: unknown,
  pageId: string,
): LinkedElement[] {
  const linked: LinkedElement[] = [];
  let total = 0;
  const visit = (node: unknown) => {
    if (Array.isArray(node)) {
      for (const item of node) visit(item);
      return;
    }
    if (typeof node !== "object" || node === null) return;
    const record = node as Record<string, unknown>;
    if (Array.isArray(record.children)) {
      total += record.children.length;
      if (total > 2500) throw new Error("A page cannot contain more than 2,500 design elements.");
      visit(record.children);
    }
    if (typeof record.id !== "string" || typeof record.type !== "string") return;
    const custom = record.custom;
    if (typeof custom !== "object" || custom === null) return;
    const applicationData = (custom as Record<string, unknown>).bestAgentMedia;
    if (typeof applicationData !== "object" || applicationData === null) return;
    const reference = applicationData as Record<string, unknown>;
    if (reference.sourceType !== "article" && reference.sourceType !== "advertisement") return;
    if (typeof reference.sourceId !== "string" || !/^[\w-]{1,64}$/.test(reference.sourceId)) {
      throw new Error("A linked canvas element has an invalid content reference.");
    }
    linked.push({
      pageId,
      elementId: record.id,
      articleId: reference.sourceType === "article" ? reference.sourceId : null,
      advertisementId: reference.sourceType === "advertisement" ? reference.sourceId : null,
    });
  };
  visit(children);
  if (new Set(linked.map(({ elementId }) => elementId)).size !== linked.length) {
    throw new Error("A canvas element cannot link to multiple content records.");
  }
  return linked;
}
