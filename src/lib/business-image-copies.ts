import "server-only";
import { randomUUID } from "node:crypto";
import { copyFile, mkdir } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { adImageDirectory, removeAdImageFiles } from "@/lib/ad-images";
import { articleImageDirectory, removeArticleImageFiles } from "@/lib/article-images";
import { businessImageDirectory } from "@/lib/business-images";
import { prisma } from "@/lib/db";

/** The business's pictures as files copied into another media folder, in their order. */
async function copyBusinessImages(businessId: number, directory: string, limit: number) {
  const images = await prisma.businessImage.findMany({
    where: { businessId },
    orderBy: { position: "asc" },
    take: limit,
    select: { fileName: true, originalName: true, mimeType: true, size: true },
  });
  if (!images.length) return { copied: [], fileNames: [] };
  await mkdir(directory, { recursive: true });
  const copied: { fileName: string; originalName: string; mimeType: string; size: number; position: number }[] = [];
  for (const [position, image] of images.entries()) {
    const fileName = `${randomUUID()}${extname(image.fileName)}`;
    await copyFile(resolve(businessImageDirectory, image.fileName), resolve(directory, fileName));
    copied.push({ fileName, originalName: image.originalName, mimeType: image.mimeType, size: image.size, position });
  }
  return { copied, fileNames: copied.map((image) => image.fileName) };
}

/** Copies the business's pictures to a new ad as its images (up to 20). Returns how many were copied. */
export async function copyBusinessImagesToAd(businessId: number, advertisementId: string): Promise<number> {
  let fileNames: string[] = [];
  try {
    const result = await copyBusinessImages(businessId, adImageDirectory, 20);
    fileNames = result.fileNames;
    if (!result.copied.length) return 0;
    await prisma.adImage.createMany({ data: result.copied.map((image) => ({ ...image, advertisementId })) });
    return result.copied.length;
  } catch {
    await removeAdImageFiles(fileNames);
    return 0;
  }
}

/** Copies the business's pictures to a new article as images (up to 5). Returns how many were copied. */
export async function copyBusinessImagesToArticle(businessId: number, articleId: string): Promise<number> {
  let fileNames: string[] = [];
  try {
    const result = await copyBusinessImages(businessId, articleImageDirectory, 5);
    fileNames = result.fileNames;
    if (!result.copied.length) return 0;
    await prisma.articleImage.createMany({
      data: result.copied.map((image) => ({ ...image, articleId })),
    });
    return result.copied.length;
  } catch {
    await removeArticleImageFiles(fileNames);
    return 0;
  }
}
