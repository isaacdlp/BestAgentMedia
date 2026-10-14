import { ArticleStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicationScope } from "@/lib/access";
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
  status: z.nativeEnum(ArticleStatus),
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

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to create articles." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    return NextResponse.json({ error: "You cannot create articles." }, { status: 403 });
  }
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
    status: formData.get("status") ?? ArticleStatus.DRAFT,
    publicationIds: formData.getAll("publicationIds"),
    businessId: rawBusinessId || undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter an article title, body, status, and at least one publication." }, { status: 400 });
  }
  const publicationScope = await getPublicationScope(user);
  if (!publicationScope) return NextResponse.json({ error: "You cannot assign publications." }, { status: 403 });
  const publications = await prisma.publication.findMany({
    where: { id: { in: parsed.data.publicationIds }, ...publicationScope },
    select: { id: true },
  });
  if (publications.length !== new Set(parsed.data.publicationIds).size) {
    return NextResponse.json({ error: "Choose only publications assigned to your workspace." }, { status: 403 });
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
    const article = await prisma.article.create({
      data: {
        title: parsed.data.title,
        body: parsed.data.body,
        status: parsed.data.status,
        createdByUserId: user.id,
        businessId: parsed.data.businessId ?? null,
        publications: { create: publications.map(({ id }) => ({ publicationId: id })) },
        images: {
          create: images.map((image) => ({
            fileName: image.fileName,
            originalName: image.originalName,
            caption: image.caption,
            mimeType: image.mimeType,
            size: image.size,
            position: image.position,
          })),
        },
      },
      select: { id: true },
    });
    return NextResponse.json({ id: article.id }, { status: 201 });
  } catch (error) {
    await removeArticleImageFiles(savedFiles);
    throw error;
  }
}
