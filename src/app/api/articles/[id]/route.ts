import { ArticleStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getArticleScope, getPublicationScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import {
  persistArticleImages,
  prepareArticleImages,
  removeArticleImageFiles,
} from "@/lib/article-images";
import { prisma } from "@/lib/db";

const maximumRequestBytes = 50 * 1024 * 1024 + 1024 * 1024;
const articleSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(50_000),
  status: z.nativeEnum(ArticleStatus).optional(),
  publicationIds: z
    .array(
      z
        .string()
        .regex(/^[1-9]\d*$/)
        .transform(Number)
        .pipe(z.number().int().positive().safe()),
    )
    .min(1),
  businessId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe())
    .optional()
    .nullable(),
});

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to edit articles." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    return NextResponse.json({ error: "You cannot edit articles." }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ error: "Article not found." }, { status: 404 });
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumRequestBytes) {
    return NextResponse.json({ error: "Article image uploads cannot exceed 50 MB at a time." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Provide valid article details." }, { status: 400 });
  }
  const rawBusinessId = formData.get("businessId");
  const parsed = articleSchema.safeParse({
    title: formData.get("title"),
    body: formData.get("body"),
    status: formData.get("status") || undefined,
    publicationIds: formData.getAll("publicationIds"),
    businessId: rawBusinessId || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an article title, body, status, and at least one publication." }, { status: 400 });
  }
  const scope = await getArticleScope(user);
  const article = await prisma.article.findFirst({
    where: { id, ...scope },
    select: {
      id: true,
      images: { select: { id: true, fileName: true } },
    },
  });
  if (!article) return NextResponse.json({ error: "Article not found." }, { status: 404 });

  const publicationScope = await getPublicationScope(user);
  if (!publicationScope) return NextResponse.json({ error: "You cannot assign publications." }, { status: 403 });
  const publications = await prisma.publication.findMany({
    where: { id: { in: parsed.data.publicationIds }, ...publicationScope },
    select: { id: true },
  });
  if (publications.length !== new Set(parsed.data.publicationIds).size) {
    return NextResponse.json({ error: "Choose only publications assigned to your workspace." }, { status: 403 });
  }

  const requestedDeletionIds = formData.getAll("removeImageId");
  if (requestedDeletionIds.some((value) => typeof value !== "string")) {
    return NextResponse.json({ error: "One or more image selections are invalid." }, { status: 400 });
  }
  const removeIds = [
    ...new Set(
      requestedDeletionIds.filter(
        (value): value is string => typeof value === "string",
      ),
    ),
  ];
  const imagesToRemove = article.images.filter(({ id: imageId }) => removeIds.includes(imageId));
  if (imagesToRemove.length !== removeIds.length) {
    return NextResponse.json({ error: "One or more selected images do not belong to this article." }, { status: 400 });
  }
  const imageCaptions = new Map<string, string>();
  for (const image of article.images) {
    const caption = formData.get(`caption_${image.id}`);
    if (typeof caption !== "string" || caption.length > 500) {
      return NextResponse.json({ error: "Image captions must be 500 characters or fewer." }, { status: 400 });
    }
    imageCaptions.set(image.id, caption.trim());
  }

  let images;
  try {
    images = await prepareArticleImages(formData);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Article images could not be processed." }, { status: 400 });
  }
  if (images.reduce((total, image) => total + image.size, 0) > 50 * 1024 * 1024) {
    return NextResponse.json({ error: "Article image uploads cannot exceed 50 MB at a time." }, { status: 413 });
  }
  const savedFiles = await persistArticleImages(images);
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.article.update({
        where: { id },
        data: {
          title: parsed.data.title,
          body: parsed.data.body,
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          businessId: parsed.data.businessId ?? null,
          publications: {
            deleteMany: {},
            create: publications.map(({ id: publicationId }) => ({ publicationId })),
          },
          images: {
            create: images.map((image, index) => ({
              fileName: image.fileName,
              originalName: image.originalName,
              caption: image.caption,
              mimeType: image.mimeType,
              size: image.size,
              position: article.images.length + index,
            })),
          },
        },
      });
      for (const [imageId, caption] of imageCaptions) {
        if (!removeIds.includes(imageId)) {
          await transaction.articleImage.update({ where: { id: imageId }, data: { caption } });
        }
      }
      if (removeIds.length) {
        await transaction.articleImage.deleteMany({
          where: { articleId: id, id: { in: removeIds } },
        });
      }
    });
  } catch (error) {
    await removeArticleImageFiles(savedFiles);
    throw error;
  }
  await removeArticleImageFiles(imagesToRemove.map(({ fileName }) => fileName));
  revalidatePath("/articles");
  revalidatePath(`/articles/${id}`);
  return NextResponse.json({ id });
}
