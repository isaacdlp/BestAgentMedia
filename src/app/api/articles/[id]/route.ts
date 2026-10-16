import { ArticleStatus, UserRole } from "@prisma/client";
import { stopTasksForSubject } from "@/lib/task-subjects";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getArticleScope, resolveIssueIds } from "@/lib/access";
import { handleAdminDelete } from "@/lib/admin-delete";
import { getCurrentUser } from "@/lib/auth";
import {
  persistArticleImages,
  prepareArticleImages,
  removeArticleImageFiles,
} from "@/lib/article-images";
import { parseDollarsToCents, parsePackageId, resolveArticleStyle } from "@/lib/ad-styles";
import { prisma } from "@/lib/db";

const maximumRequestBytes = 50 * 1024 * 1024 + 1024 * 1024;
const recordIdSchema = z.string().regex(/^[\w-]{1,64}$/);
const articleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  status: z.nativeEnum(ArticleStatus),
  issueIds: z.array(recordIdSchema).min(1),
  businessId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe())
    .optional(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to edit articles." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "You cannot edit articles." }, { status: 403 });
  }
  const { id } = await params;
  if (!recordIdSchema.safeParse(id).success) {
    return NextResponse.json({ error: "Article not found." }, { status: 404 });
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumRequestBytes) {
    return NextResponse.json({ error: "Article image uploads cannot exceed 50 MB at a time." }, { status: 413 });
  }

  const article = await prisma.article.findFirst({
    where: { id, ...(await getArticleScope(user)) },
    select: { id: true, status: true, images: { select: { id: true, fileName: true, position: true } } },
  });
  if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Provide valid article details." }, { status: 400 });
  }
  const parsed = articleSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    status: formData.get("status") ?? article.status,
    issueIds: formData.getAll("issueIds"),
    businessId: formData.get("businessId") || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an article title, body, status, and at least one issue." }, { status: 400 });
  }
  const issueIds = await resolveIssueIds(user, parsed.data.issueIds);
  if (!issueIds) {
    return NextResponse.json({ error: "Choose only issues of publications assigned to your workspace." }, { status: 403 });
  }
  let pricing;
  try {
    pricing = parsed.data.businessId
      ? await resolveArticleStyle(parsePackageId(formData.get("packageId")), issueIds, parseDollarsToCents(formData.get("cost")))
      : { promotionPackageId: null, styleName: null, costCents: null };
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Choose a valid promotion style." }, { status: 400 });
  }

  const existingIds = new Set(article.images.map((image) => image.id));
  const removeIds = new Set(
    formData.getAll("removeImageId").filter((value): value is string => typeof value === "string" && existingIds.has(value)),
  );
  // The submitted order of the existing images; any image missing from it keeps its place at the end.
  const orderedIds = [
    ...new Set(
      formData
        .getAll("imageOrder")
        .filter((value): value is string => typeof value === "string" && existingIds.has(value) && !removeIds.has(value)),
    ),
  ];
  const remainingIds = [...article.images]
    .sort((a, b) => a.position - b.position)
    .filter((image) => !removeIds.has(image.id) && !orderedIds.includes(image.id))
    .map((image) => image.id);
  const finalOrder = [...orderedIds, ...remainingIds];

  let images;
  try {
    images = await prepareArticleImages(formData);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Article images could not be processed." }, { status: 400 });
  }
  if (images.reduce((total, image) => total + image.size, 0) > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "Article image uploads cannot exceed 50 MB at a time." }, { status: 413 });
  }
  const nextPosition = finalOrder.length;

  const savedFiles = await persistArticleImages(images);
  try {
    await prisma.$transaction([
      prisma.articleIssue.deleteMany({ where: { articleId: article.id } }),
      prisma.articleImage.deleteMany({ where: { articleId: article.id, id: { in: [...removeIds] } } }),
      ...finalOrder.map((imageId, position) =>
        prisma.articleImage.update({ where: { id: imageId }, data: { position } }),
      ),
      prisma.article.update({
        where: { id: article.id },
        data: {
          title: parsed.data.title,
          body: parsed.data.body,
          status: parsed.data.status,
          businessId: parsed.data.businessId ?? null,
          ...pricing,
          issues: { create: issueIds.map((issueId) => ({ issueId })) },
          images: {
            create: images.map((image) => ({
              fileName: image.fileName,
              originalName: image.originalName,
              mimeType: image.mimeType,
              size: image.size,
              position: nextPosition + image.position,
            })),
          },
        },
      }),
    ]);
  } catch (error) {
    await removeArticleImageFiles(savedFiles);
    throw error;
  }
  await removeArticleImageFiles(
    article.images.filter((image) => removeIds.has(image.id)).map((image) => image.fileName),
  );
  if (parsed.data.status === "ACCEPTED") await stopTasksForSubject("article", article.id);
  return NextResponse.json({ id: article.id });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAdminDelete("article", id);
}
