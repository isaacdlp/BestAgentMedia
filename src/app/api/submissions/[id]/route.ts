import { NextResponse } from "next/server";
import { SubmissionStatus, UserRole } from "@prisma/client";
import { z } from "zod";
import { getPublicationScope, getSubmissionScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import {
  maximumSubmissionImageBytes,
  maximumSubmissionImages,
  persistSubmissionImages,
  prepareSubmissionImages,
  removeSubmissionImageFiles,
} from "@/lib/submission-images";
import { prisma } from "@/lib/db";

const updateSubmissionSchema = z.object({
  postalCode: z.string().regex(/^\d{5}$/),
  publicationId: z.string().regex(/^[1-9]\d*$/).transform(Number),
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
  title: z.string().trim().min(1).max(200),
  body: z.string().trim().min(1).max(20_000),
  submitterName: z.string().trim().min(1).max(201),
  submitterEmail: z.string().trim().email().max(320),
  submitterPhone: z.string().trim().max(50),
  status: z.nativeEnum(SubmissionStatus).optional(),
  businessId: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe())
    .optional()
    .nullable(),
});

const maximumRequestBytes =
  maximumSubmissionImages * maximumSubmissionImageBytes + 1024 * 1024;

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "Sign in to edit this submission." },
      { status: 401 },
    );
  }
  const scope = await getSubmissionScope(user);
  if (!scope) {
    return NextResponse.json(
      { error: "You cannot edit submissions." },
      { status: 403 },
    );
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumRequestBytes) {
    return NextResponse.json(
      { error: "The total image upload cannot exceed 50 MB." },
      { status: 413 },
    );
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json(
      { error: "Provide valid submission details." },
      { status: 400 },
    );
  }

  const canManageStatus =
    user.role === UserRole.ADMIN || user.role === UserRole.PUBLISHER;
  const rawBusinessId = formData.get("businessId");
  const parsed = updateSubmissionSchema.safeParse({
    postalCode: formData.get("postalCode"),
    publicationId: formData.get("publicationId"),
    storyType: formData.get("storyType"),
    title: formData.get("title"),
    body: formData.get("body"),
    submitterName: formData.get("submitterName"),
    submitterEmail: formData.get("submitterEmail"),
    submitterPhone: formData.get("submitterPhone"),
    status: canManageStatus ? formData.get("status") : undefined,
    businessId: canManageStatus && rawBusinessId ? rawBusinessId : undefined,
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Complete all required fields with valid information." },
      { status: 400 },
    );
  }

  const submission = await prisma.contentSubmission.findFirst({
    where: { id, ...scope },
    select: {
      id: true,
      publicationId: true,
      images: { select: { id: true, fileName: true } },
    },
  });
  if (!submission) {
    return NextResponse.json({ error: "Submission not found." }, { status: 404 });
  }

  const publication = await prisma.publication.findFirst({
    where: {
      id: parsed.data.publicationId,
      zipCodes: { some: { code: parsed.data.postalCode } },
    },
    select: { id: true },
  });
  if (!publication) {
    return NextResponse.json(
      { error: "That publication is not available for the selected ZIP code." },
      { status: 400 },
    );
  }

  const requestedDeletionIds = formData.getAll("removeImageId");
  if (requestedDeletionIds.some((imageId) => typeof imageId !== "string")) {
    return NextResponse.json(
      { error: "One or more selected images are invalid." },
      { status: 400 },
    );
  }
  const removeImageIds = [
    ...new Set(
      requestedDeletionIds.filter(
        (imageId): imageId is string => typeof imageId === "string",
      ),
    ),
  ];
  const imagesToRemove = submission.images.filter((image) =>
    removeImageIds.includes(image.id),
  );
  if (imagesToRemove.length !== removeImageIds.length) {
    return NextResponse.json(
      { error: "One or more selected images do not belong to this submission." },
      { status: 400 },
    );
  }

  let images;
  try {
    images = await prepareSubmissionImages(formData);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "The selected images could not be processed.",
      },
      { status: 400 },
    );
  }
  if (
    submission.images.length - imagesToRemove.length + images.length >
    maximumSubmissionImages
  ) {
    return NextResponse.json(
      { error: "A submission can have no more than five images." },
      { status: 400 },
    );
  }

  const publicationScope =
    user.role === null
      ? { id: submission.publicationId }
      : await getPublicationScope(user);
  if (!publicationScope) {
    return NextResponse.json(
      { error: "You cannot change this submission's publication." },
      { status: 403 },
    );
  }
  const authorizedPublication = await prisma.publication.findFirst({
    where: {
      id: publication.id,
      zipCodes: { some: { code: parsed.data.postalCode } },
      AND: [publicationScope],
    },
    select: { id: true },
  });
  if (!authorizedPublication) {
    return NextResponse.json(
      { error: "You cannot assign this story to that publication." },
      { status: 403 },
    );
  }

  const persistedFileNames = await persistSubmissionImages(images);
  try {
    await prisma.$transaction(async (transaction) => {
      await transaction.contentSubmission.update({
        where: { id },
        data: {
          title: parsed.data.title,
          body: parsed.data.body,
          storyType: parsed.data.storyType,
          postalCode: parsed.data.postalCode,
          submitterName: parsed.data.submitterName,
          submitterEmail: parsed.data.submitterEmail,
          submitterPhone: parsed.data.submitterPhone || null,
          publicationId: publication.id,
          ...(parsed.data.status ? { status: parsed.data.status } : {}),
          ...(canManageStatus ? { businessId: parsed.data.businessId ?? null } : {}),
          images: {
            create: images.map((image) => ({
              fileName: image.fileName,
              originalName: image.originalName,
              mimeType: image.mimeType,
              size: image.size,
            })),
          },
        },
      });
      if (removeImageIds.length) {
        await transaction.submissionImage.deleteMany({
          where: { submissionId: id, id: { in: removeImageIds } },
        });
      }
    });
  } catch (error) {
    await removeSubmissionImageFiles(persistedFileNames);
    throw error;
  }

  await removeSubmissionImageFiles(imagesToRemove.map((image) => image.fileName));
  const savedImages = await prisma.submissionImage.findMany({
    where: { submissionId: id },
    orderBy: { createdAt: "asc" },
    select: { id: true, originalName: true, size: true },
  });
  return NextResponse.json({
    message: "Submission changes saved.",
    images: savedImages,
  });
}
