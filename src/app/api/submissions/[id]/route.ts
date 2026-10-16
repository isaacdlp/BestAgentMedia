import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { z } from "zod";
import { getPublicationScope, getSubmissionScope } from "@/lib/access";
import { handleAdminDelete } from "@/lib/admin-delete";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  maximumSubmissionImageBytes,
  maximumSubmissionImages,
  persistSubmissionImages,
  prepareSubmissionImages,
  removeSubmissionImageFiles,
} from "@/lib/submission-images";

const maximumRequestBytes =
  maximumSubmissionImages * maximumSubmissionImageBytes + 1024 * 1024;
const positiveId = z.string().regex(/^[1-9]\d*$/).transform(Number);
const submissionSchema = z.object({
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  storyType: z.enum([
    "community",
    "family",
    "event",
    "organization",
    "pet",
    "sports",
    "announcement",
    "other",
  ]),
  postalCode: z.string().trim().regex(/^\d{5}$/).or(z.literal("")),
  submitterName: z.string().trim().max(200),
  submitterEmail: z.string().trim().email().max(320).or(z.literal("")),
  submitterPhone: z.string().trim().max(50),
  publicationId: positiveId,
  businessId: positiveId.optional(),
});

function field(formData: FormData, name: string) {
  const value = formData.get(name);
  return typeof value === "string" ? value : undefined;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to edit submissions." }, { status: 401 });
  }
  const scope = await getSubmissionScope(user);
  if (!scope) {
    return NextResponse.json({ error: "You cannot edit submissions." }, { status: 403 });
  }
  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }
  const length = Number(request.headers.get("content-length"));
  if (Number.isFinite(length) && length > maximumRequestBytes) {
    return NextResponse.json({ error: "The total image upload cannot exceed 50 MB." }, { status: 413 });
  }

  const submission = await prisma.contentSubmission.findFirst({
    where: { id, ...scope },
    select: {
      id: true,
      publicationId: true,
      businessId: true,
      images: { select: { id: true, fileName: true } },
    },
  });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Provide valid submission details." }, { status: 400 });
  }

  const canManage = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;
  const parsed = submissionSchema.safeParse({
    title: field(formData, "title"),
    body: field(formData, "body"),
    storyType: field(formData, "storyType"),
    postalCode: field(formData, "postalCode") ?? "",
    submitterName: field(formData, "submitterName") ?? "",
    submitterEmail: field(formData, "submitterEmail") ?? "",
    submitterPhone: field(formData, "submitterPhone") ?? "",
    publicationId: canManage
      ? field(formData, "publicationId")
      : String(submission.publicationId),
    businessId: canManage ? field(formData, "businessId") || undefined : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Complete the title, category, and story details with valid information." },
      { status: 400 },
    );
  }

  if (canManage && parsed.data.publicationId !== submission.publicationId) {
    const publicationScope = await getPublicationScope(user);
    const publication = publicationScope
      ? await prisma.publication.findFirst({
          where: { id: parsed.data.publicationId, ...publicationScope },
          select: { id: true },
        })
      : null;
    if (!publication) {
      return NextResponse.json({ error: "Choose a publication assigned to your workspace." }, { status: 403 });
    }
  }
  if (parsed.data.businessId) {
    const business = await prisma.business.findUnique({
      where: { id: parsed.data.businessId },
      select: { id: true },
    });
    if (!business) {
      return NextResponse.json({ error: "The selected business was not found." }, { status: 400 });
    }
  }

  const existingIds = new Set(submission.images.map((image) => image.id));
  const removeIds = new Set(
    formData
      .getAll("removeImageId")
      .filter((value): value is string => typeof value === "string" && existingIds.has(value)),
  );
  let images;
  try {
    images = await prepareSubmissionImages(formData);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The selected images could not be processed." },
      { status: 400 },
    );
  }
  if (submission.images.length - removeIds.size + images.length > maximumSubmissionImages) {
    return NextResponse.json(
      { error: `A submission can have at most ${maximumSubmissionImages} images.` },
      { status: 400 },
    );
  }

  const savedFiles = await persistSubmissionImages(images);
  try {
    await prisma.$transaction([
      prisma.submissionImage.deleteMany({
        where: { submissionId: submission.id, id: { in: [...removeIds] } },
      }),
      prisma.contentSubmission.update({
        where: { id: submission.id },
        data: {
          title: parsed.data.title,
          body: parsed.data.body,
          storyType: parsed.data.storyType,
          postalCode: parsed.data.postalCode || null,
          submitterName: parsed.data.submitterName || null,
          submitterEmail: parsed.data.submitterEmail || null,
          submitterPhone: parsed.data.submitterPhone || null,
          ...(canManage
            ? {
                publicationId: parsed.data.publicationId,
                businessId: parsed.data.businessId ?? null,
              }
            : {}),
          images: {
            create: images.map((image) => ({
              fileName: image.fileName,
              originalName: image.originalName,
              mimeType: image.mimeType,
              size: image.size,
            })),
          },
        },
      }),
    ]);
  } catch (error) {
    await removeSubmissionImageFiles(savedFiles);
    throw error;
  }
  await removeSubmissionImageFiles(
    submission.images.filter((image) => removeIds.has(image.id)).map((image) => image.fileName),
  );

  const saved = await prisma.submissionImage.findMany({
    where: { submissionId: submission.id },
    orderBy: { createdAt: "asc" },
    select: { id: true, originalName: true, size: true },
  });
  return NextResponse.json({ message: "Submission changes saved.", images: saved });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  return handleAdminDelete("submission", id);
}
