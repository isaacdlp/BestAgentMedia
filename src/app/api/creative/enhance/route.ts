import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { launchEnhanceImage, type ImageType } from "@/lib/creative-agent";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to enhance images." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "Administrators and editors only." }, { status: 403 });
  }

  let body: {
    imageType?: unknown;
    imageId?: unknown;
    parentId?: unknown;
    customInstructions?: unknown;
    iterateFromTaskId?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { imageType, imageId, parentId, customInstructions, iterateFromTaskId } = body;

  if (
    typeof imageType !== "string" ||
    !["submission", "article", "business", "ad", "publication"].includes(imageType)
  ) {
    return NextResponse.json({ error: "Invalid imageType." }, { status: 400 });
  }
  if (typeof imageId !== "string" || !/^[\w-]{1,64}$/.test(imageId)) {
    return NextResponse.json({ error: "Invalid imageId." }, { status: 400 });
  }
  if (typeof parentId !== "string" || !/^[\w-]{1,64}$/.test(parentId)) {
    return NextResponse.json({ error: "Invalid parentId." }, { status: 400 });
  }

  const custom = typeof customInstructions === "string" ? customInstructions.slice(0, 2000) : "";
  const iterFromId =
    typeof iterateFromTaskId === "string" && /^[\w-]{1,64}$/.test(iterateFromTaskId)
      ? iterateFromTaskId
      : undefined;

  const typedImageType = imageType as ImageType;
  let originalFileName: string;
  let originalMimeType: string;
  const originalDir: "submissions" | "articles" | "businesses" | "ads" | "publications" =
    typedImageType === "submission"
      ? "submissions"
      : typedImageType === "article"
        ? "articles"
        : typedImageType === "business"
          ? "businesses"
          : typedImageType === "ad"
            ? "ads"
            : "publications";

  try {
    if (typedImageType === "submission") {
      const img = await prisma.submissionImage.findFirst({
        where: { id: imageId, submissionId: parentId },
        select: { fileName: true, mimeType: true },
      });
      if (!img) return NextResponse.json({ error: "Image not found." }, { status: 404 });
      originalFileName = img.fileName;
      originalMimeType = img.mimeType;
    } else if (typedImageType === "article") {
      const img = await prisma.articleImage.findFirst({
        where: { id: imageId, articleId: parentId },
        select: { fileName: true, mimeType: true },
      });
      if (!img) return NextResponse.json({ error: "Image not found." }, { status: 404 });
      originalFileName = img.fileName;
      originalMimeType = img.mimeType;
    } else if (typedImageType === "business") {
      const businessId = Number(parentId);
      if (!Number.isSafeInteger(businessId))
        return NextResponse.json({ error: "Invalid business ID." }, { status: 400 });
      const img = await prisma.businessImage.findFirst({
        where: { id: imageId, businessId },
        select: { fileName: true, mimeType: true },
      });
      if (!img) return NextResponse.json({ error: "Image not found." }, { status: 404 });
      originalFileName = img.fileName;
      originalMimeType = img.mimeType;
    } else if (typedImageType === "ad") {
      const img = await prisma.adImage.findFirst({
        where: { id: imageId, advertisementId: parentId },
        select: { fileName: true, mimeType: true },
      });
      if (!img) return NextResponse.json({ error: "Image not found." }, { status: 404 });
      originalFileName = img.fileName;
      originalMimeType = img.mimeType;
    } else {
      // publication — imageId and parentId are the publication's numeric ID as string
      const pubId = Number(imageId);
      if (!Number.isSafeInteger(pubId) || pubId < 1)
        return NextResponse.json({ error: "Invalid publication ID." }, { status: 400 });
      const pub = await prisma.publication.findUnique({
        where: { id: pubId },
        select: { coverImagePath: true },
      });
      if (!pub?.coverImagePath)
        return NextResponse.json({ error: "This publication has no cover image." }, { status: 404 });
      const match = /([^/\\]+)$/.exec(pub.coverImagePath);
      if (!match) return NextResponse.json({ error: "Invalid cover image path." }, { status: 500 });
      originalFileName = match[1];
      originalMimeType =
        /\.jpe?g$/i.test(originalFileName) ? "image/jpeg" : "image/png";
    }
  } catch (err) {
    if (err instanceof NextResponse) return err;
    return NextResponse.json({ error: "Failed to look up image record." }, { status: 500 });
  }

  try {
    const task = await launchEnhanceImage({
      imageType: typedImageType,
      imageId,
      parentId,
      originalFileName,
      originalDir,
      originalMimeType,
      customInstructions: custom,
      triggeredById: user.id,
      iterateFromTaskId: iterFromId,
    });
    return NextResponse.json({ task }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Enhancement could not be started.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
