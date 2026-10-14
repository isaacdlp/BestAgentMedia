import { NextResponse } from "next/server";
import { z } from "zod";
import { triggerSubmissionInvite } from "@/lib/assistant-agent";
import { getCurrentUser } from "@/lib/auth";
import {
  maximumSubmissionImages,
  maximumSubmissionImageBytes,
  persistSubmissionImages,
  prepareSubmissionImages,
  removeSubmissionImageFiles,
} from "@/lib/submission-images";
import { prisma } from "@/lib/db";

const createSubmissionSchema = z.object({
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
  firstName: z.string().trim().min(1).max(100),
  lastName: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(320),
  phone: z.string().trim().max(50),
  consent: z.literal("true"),
});

const maximumRequestBytes =
  maximumSubmissionImages * maximumSubmissionImageBytes + 1024 * 1024;

export async function POST(request: Request) {
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
      { error: "Provide a valid story submission." },
      { status: 400 },
    );
  }

  const parsed = createSubmissionSchema.safeParse({
    postalCode: formData.get("postalCode"),
    publicationId: formData.get("publicationId"),
    storyType: formData.get("storyType"),
    title: formData.get("title"),
    body: formData.get("body"),
    firstName: formData.get("firstName"),
    lastName: formData.get("lastName"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    consent: formData.get("consent"),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Complete all required fields with valid information." },
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

  const user = await getCurrentUser();
  const persistedFileNames = await persistSubmissionImages(images);
  try {
    const submission = await prisma.contentSubmission.create({
      data: {
        title: parsed.data.title,
        body: parsed.data.body,
        storyType: parsed.data.storyType,
        postalCode: parsed.data.postalCode,
        submitterName: `${parsed.data.firstName} ${parsed.data.lastName}`,
        submitterEmail: parsed.data.email,
        submitterPhone: parsed.data.phone || null,
        publicationId: publication.id,
        submittedByUserId: user?.id ?? null,
        images: {
          create: images.map((image) => ({
            fileName: image.fileName,
            originalName: image.originalName,
            mimeType: image.mimeType,
            size: image.size,
          })),
        },
      },
      select: { id: true },
    });

    // Fire-and-forget: queue an Assistant agent email draft for this submission
    void triggerSubmissionInvite(submission.id);

    return NextResponse.json(
      {
        message: "Your story has been submitted for review.",
        submissionId: submission.id,
      },
      { status: 201 },
    );
  } catch (error) {
    await removeSubmissionImageFiles(persistedFileNames);
    throw error;
  }
}
