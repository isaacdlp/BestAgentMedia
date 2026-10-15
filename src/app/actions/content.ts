"use server";

import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import {
  ArticleStatus,
  IssuePageType,
  IssueStatus,
  UserRole,
} from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import {
  getArticleScope,
  getIssueScope,
  getPublicationScope,
  getSubmissionScope,
} from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { articleImageDirectory, removeArticleImageFiles } from "@/lib/article-images";
import { submissionImageDirectory } from "@/lib/submission-images";
import { prisma } from "@/lib/db";
import { slugify } from "@/lib/issue-naming";

const idSchema = z.string().regex(/^[\w-]{1,64}$/);
const numericIdSchema = z
  .string()
  .regex(/^[1-9]\d*$/)
  .transform(Number)
  .pipe(z.number().int().positive().safe());
const statusSchema = z.nativeEnum(IssueStatus);
const articleStatusSchema = z.nativeEnum(ArticleStatus);

export async function createIssue(formData: FormData) {
  const user = await requireUser();
  const issueScope = await getIssueScope(user);
  if (!issueScope) redirect("/dashboard");

  const publicationId = numericIdSchema.parse(formData.get("publicationId"));
  const publicationDate = parsePublicationDate(formData.get("publicationDate"));
  const { name, slug: requestedSlug, description } = parseIssueText(formData);
  const publicationScope = await getPublicationScope(user);
  if (
    !publicationScope ||
    !(await prisma.publication.findFirst({
      where: { id: publicationId, ...publicationScope },
      select: { id: true },
    }))
  ) {
    throw new Error("Choose a publication assigned to your workspace.");
  }

  const slug = await uniqueIssueSlug(publicationId, requestedSlug);
  const issue = await prisma.issue.create({
    data: {
      publicationId,
      name,
      slug,
      description,
      publicationDate,
      pages: {
        create: [
          { pageNumber: 1, type: IssuePageType.COVER },
          { pageNumber: 2, type: IssuePageType.INNER },
          { pageNumber: 3, type: IssuePageType.BACK_COVER },
        ],
      },
    },
    select: { id: true },
  });
  revalidatePath("/issues");
  redirect(`/issues/${issue.id}`);
}

const issueTextSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug may contain only lowercase letters, numbers and hyphens."),
  description: z.string().trim().max(5000),
});

function parseIssueText(formData: FormData) {
  const name = String(formData.get("name") ?? "");
  const parsed = issueTextSchema.parse({
    name,
    slug: String(formData.get("slug") ?? "") || slugify(name),
    description: String(formData.get("description") ?? ""),
  });
  return { ...parsed, description: parsed.description || null };
}

async function uniqueIssueSlug(publicationId: number, slug: string) {
  let candidate = slug;
  for (let suffix = 2; ; suffix += 1) {
    const existing = await prisma.issue.findFirst({
      where: { publicationId, slug: candidate },
      select: { id: true },
    });
    if (!existing) return candidate;
    candidate = `${slug}-${suffix}`;
  }
}

export async function updateIssueDetails(formData: FormData) {
  const user = await requireUser();
  const scope = await getIssueScope(user);
  if (!scope) redirect("/dashboard");
  const id = idSchema.parse(formData.get("id"));
  const status = statusSchema.parse(formData.get("status"));
  const publicationDate = parsePublicationDate(formData.get("publicationDate"));
  const { name, slug, description } = parseIssueText(formData);
  const current = await prisma.issue.findFirst({
    where: { id, ...scope },
    select: { publicationId: true, slug: true },
  });
  if (!current) throw new Error("Issue not found or not accessible.");
  if (slug !== current.slug && (await prisma.issue.findFirst({
    where: { publicationId: current.publicationId, slug, NOT: { id } },
    select: { id: true },
  }))) {
    throw new Error("Another issue of this publication already uses that slug.");
  }
  const result = await prisma.issue.updateMany({
    where: { id, ...scope },
    data: { status, publicationDate, name, slug, description },
  });
  if (result.count !== 1) throw new Error("Issue not found or not accessible.");
  revalidatePath("/issues");
  revalidatePath(`/issues/${id}`);
}

export async function updateArticleStatus(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }
  const id = idSchema.parse(formData.get("id"));
  const status = articleStatusSchema.parse(formData.get("status"));
  const scope = await getArticleScope(user);
  const result = await prisma.article.updateMany({
    where: { id, ...scope },
    data: { status },
  });
  if (result.count !== 1) throw new Error("Article not found or not accessible.");
  revalidatePath("/articles");
  revalidatePath(`/articles/${id}`);
}

export async function promoteSubmissionToArticle(formData: FormData) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    redirect("/dashboard");
  }
  const id = idSchema.parse(formData.get("submissionId"));
  const submissionScope = await getSubmissionScope(user);
  if (!submissionScope) redirect("/dashboard");
  const submission = await prisma.contentSubmission.findFirst({
    where: { id, ...submissionScope },
    include: { images: { orderBy: { createdAt: "asc" } } },
  });
  if (!submission) throw new Error("Submission not found or not accessible.");
  let article = await prisma.article.findUnique({
    where: { sourceSubmissionId: id },
    select: { id: true },
  });
  if (!article) {
    await mkdir(articleImageDirectory, { recursive: true });
    const copiedFileNames: string[] = [];
    const images = submission.images.map((image, position) => ({
      ...image,
      position,
      articleFileName: `${randomUUID()}${extname(image.fileName)}`,
    }));
    try {
      for (const image of images) {
        await copyFile(
          resolve(submissionImageDirectory, image.fileName),
          resolve(articleImageDirectory, image.articleFileName),
        );
        copiedFileNames.push(image.articleFileName);
      }
      article = await prisma.article.create({
        data: {
          title: submission.title,
          body: submission.body,
          status: ArticleStatus.DRAFT,
          sourceSubmissionId: id,
          createdByUserId: user.id,
          images: {
            create: images.map((image) => ({
              fileName: image.articleFileName,
              originalName: image.originalName,
              caption: "",
              mimeType: image.mimeType,
              size: image.size,
              position: image.position,
            })),
          },
        },
        select: { id: true },
      });
    } catch (error) {
      await removeArticleImageFiles(copiedFileNames);
      throw error;
    }
  }
  revalidatePath("/articles");
  redirect(`/articles/${article.id}`);
}

function parsePublicationDate(value: FormDataEntryValue | null) {
  const parsed = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(value);
  const date = new Date(`${parsed}T00:00:00.000Z`);
  if (Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== parsed) {
    throw new Error("Enter a valid publication date.");
  }
  return date;
}
