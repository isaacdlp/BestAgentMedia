import { copyFile, readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { UserRole, Prisma } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { creativeImageDirectory, type CreativeTaskResult } from "@/lib/creative-agent";
import { articleImageDirectory } from "@/lib/article-images";
import { businessImageDirectory } from "@/lib/business-images";
import { submissionImageDirectory } from "@/lib/submission-images";
import { adImageDirectory } from "@/lib/ad-images";
import { prisma } from "@/lib/db";
import { randomUUID } from "node:crypto";

const publicationMediaDirectory = resolve(process.cwd(), "media", "publications");

function originalDirToPath(dir: CreativeTaskResult["originalDir"]): string {
  switch (dir) {
    case "submissions": return submissionImageDirectory;
    case "articles": return articleImageDirectory;
    case "businesses": return businessImageDirectory;
    case "ads": return adImageDirectory;
    case "publications": return publicationMediaDirectory;
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ taskId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to apply changes." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "Administrators and editors only." }, { status: 403 });
  }

  const { taskId } = await params;
  if (!/^[\w-]{1,64}$/.test(taskId)) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  let body: { action?: unknown } = {};
  try {
    body = (await request.json()) as { action?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { action } = body;
  if (!action || !["remove", "overwrite", "keep", "iterate"].includes(action as string)) {
    return NextResponse.json({ error: "action must be remove, overwrite, keep, or iterate." }, { status: 400 });
  }

  const agent = await prisma.agent.findUnique({
    where: { slug: "creative" },
    select: { id: true },
  });
  if (!agent) return NextResponse.json({ error: "Creative agent not configured." }, { status: 500 });

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, agentId: agent.id },
    select: { id: true, result: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const result = task.result as CreativeTaskResult | null;
  if (!result?.enhancedFileName) {
    return NextResponse.json({ error: "Task has no enhanced image." }, { status: 409 });
  }
  if (result.status !== "pending_review") {
    return NextResponse.json({ error: "This task has already been resolved." }, { status: 409 });
  }

  if (action === "overwrite" && result.trigger === "generate-ad") {
    return NextResponse.json({ error: "Overwrite is not available for generated ads — use Save as Image instead." }, { status: 400 });
  }

  if (!/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(result.enhancedFileName)) {
    return NextResponse.json({ error: "Invalid enhanced image filename." }, { status: 500 });
  }

  const enhancedPath = resolve(creativeImageDirectory, result.enhancedFileName);

  async function updateTaskStatus(status: CreativeTaskResult["status"]) {
    const updatedResult: CreativeTaskResult = { ...result!, status };
    await prisma.agentTask.update({
      where: { id: taskId },
      data: { result: updatedResult as unknown as Prisma.InputJsonValue },
    });
  }

  if (action === "remove") {
    await rm(enhancedPath, { force: true });
    await updateTaskStatus("discarded");
    return NextResponse.json({ message: "Enhanced image removed." });
  }

  if (action === "iterate") {
    await updateTaskStatus("iterating");
    return NextResponse.json({ message: "Ready to iterate.", iterateFromTaskId: taskId });
  }

  // Read enhanced image bytes (needed for overwrite and keep)
  let enhancedBuffer: Buffer;
  try {
    enhancedBuffer = await readFile(enhancedPath);
  } catch {
    return NextResponse.json({ error: "Enhanced image file not found." }, { status: 404 });
  }

  const originalDirPath = originalDirToPath(result.originalDir);

  if (action === "overwrite") {
    if (result.imageType === "publication") {
      // For publication covers, update the file and the DB path
      const pubId = Number(result.parentId);
      if (!Number.isSafeInteger(pubId)) return NextResponse.json({ error: "Invalid publication ID." }, { status: 500 });

      const pub = await prisma.publication.findUnique({ where: { id: pubId }, select: { coverImagePath: true } });
      if (!pub) return NextResponse.json({ error: "Publication not found." }, { status: 404 });

      const ext = result.enhancedMimeType === "image/jpeg" ? "jpg" : result.enhancedMimeType === "image/webp" ? "webp" : "png";
      const newFileName = `${randomUUID()}.${ext}`;
      const newPath = resolve(publicationMediaDirectory, newFileName);

      await writeFile(newPath, enhancedBuffer, { flag: "wx" });
      await prisma.publication.update({
        where: { id: pubId },
        data: { coverImagePath: `media/publications/${newFileName}` },
      });
      // Remove old cover if it exists and is different
      if (pub.coverImagePath) {
        const oldMatch = /([^/\\]+)$/.exec(pub.coverImagePath);
        if (oldMatch && oldMatch[1] !== newFileName) {
          await rm(resolve(publicationMediaDirectory, oldMatch[1]), { force: true });
        }
      }
      await rm(enhancedPath, { force: true });
      await updateTaskStatus("accepted_overwrite");
      return NextResponse.json({ message: "Publication cover replaced." });
    }

    // For all other image types: overwrite the file in place, update size/mimeType in DB
    const originalPath = resolve(originalDirPath, result.originalFileName);
    await writeFile(originalPath, enhancedBuffer);

    if (result.imageType === "submission") {
      await prisma.submissionImage.update({
        where: { id: result.imageId },
        data: { size: enhancedBuffer.byteLength, mimeType: result.enhancedMimeType },
      });
    } else if (result.imageType === "article") {
      await prisma.articleImage.update({
        where: { id: result.imageId },
        data: { size: enhancedBuffer.byteLength, mimeType: result.enhancedMimeType },
      });
    } else if (result.imageType === "business") {
      await prisma.businessImage.update({
        where: { id: result.imageId },
        data: { size: enhancedBuffer.byteLength, mimeType: result.enhancedMimeType },
      });
    } else if (result.imageType === "ad") {
      await prisma.adImage.update({
        where: { id: result.imageId },
        data: { size: enhancedBuffer.byteLength, mimeType: result.enhancedMimeType },
      });
    }

    await rm(enhancedPath, { force: true });
    await updateTaskStatus("accepted_overwrite");
    return NextResponse.json({ message: "Original image replaced with enhanced version." });
  }

  if (action === "keep") {
    // Create a new image record alongside the original
    const ext = result.enhancedMimeType === "image/jpeg" ? "jpg" : result.enhancedMimeType === "image/webp" ? "webp" : "png";
    const newFileName = `${randomUUID()}.${ext}`;
    const newPath = resolve(originalDirPath, newFileName);

    await copyFile(enhancedPath, newPath);

    const baseName = result.originalFileName.replace(/\.[^.]+$/, "");
    const enhancedOriginalName = result.trigger === "generate-ad"
      ? `generated-ad.${ext}`
      : `${baseName}-enhanced.${ext}`;

    if (result.imageType === "submission") {
      await prisma.submissionImage.create({
        data: {
          submissionId: result.parentId,
          fileName: newFileName,
          originalName: enhancedOriginalName,
          mimeType: result.enhancedMimeType,
          size: enhancedBuffer.byteLength,
        },
      });
    } else if (result.imageType === "article") {
      const maxPos = await prisma.articleImage.aggregate({
        where: { articleId: result.parentId },
        _max: { position: true },
      });
      await prisma.articleImage.create({
        data: {
          articleId: result.parentId,
          fileName: newFileName,
          originalName: enhancedOriginalName,
          mimeType: result.enhancedMimeType,
          size: enhancedBuffer.byteLength,
          position: (maxPos._max.position ?? -1) + 1,
        },
      });
    } else if (result.imageType === "business") {
      const businessId = Number(result.parentId);
      const maxPos = await prisma.businessImage.aggregate({
        where: { businessId },
        _max: { position: true },
      });
      await prisma.businessImage.create({
        data: {
          businessId,
          fileName: newFileName,
          originalName: enhancedOriginalName,
          mimeType: result.enhancedMimeType,
          size: enhancedBuffer.byteLength,
          position: (maxPos._max.position ?? -1) + 1,
        },
      });
    } else if (result.imageType === "ad") {
      const maxPos = await prisma.adImage.aggregate({
        where: { advertisementId: result.parentId },
        _max: { position: true },
      });
      await prisma.adImage.create({
        data: {
          advertisementId: result.parentId,
          fileName: newFileName,
          originalName: enhancedOriginalName,
          mimeType: result.enhancedMimeType,
          size: enhancedBuffer.byteLength,
          position: (maxPos._max.position ?? -1) + 1,
        },
      });
    } else {
      // publication: "keep" treated same as overwrite — only one cover
      const pubId = Number(result.parentId);
      const pub = await prisma.publication.findUnique({ where: { id: pubId }, select: { coverImagePath: true } });
      if (pub?.coverImagePath) {
        const oldMatch = /([^/\\]+)$/.exec(pub.coverImagePath);
        if (oldMatch) await rm(resolve(publicationMediaDirectory, oldMatch[1]), { force: true });
      }
      await prisma.publication.update({
        where: { id: pubId },
        data: { coverImagePath: `media/publications/${newFileName}` },
      });
    }

    await rm(enhancedPath, { force: true });
    await updateTaskStatus("accepted_keep");
    return NextResponse.json({ message: "Enhanced image kept as new." });
  }

  return NextResponse.json({ error: "Unknown action." }, { status: 400 });
}
