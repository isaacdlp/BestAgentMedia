import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

export const articleImageDirectory = resolve(process.cwd(), "media", "articles");
const maximumImageBytes = 10 * 1024 * 1024;
const maximumImagePixels = 40_000_000;

export type PreparedArticleImage = {
  buffer: Buffer;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  caption: string;
  position: number;
};

export async function prepareArticleImages(formData: FormData) {
  const values = formData.getAll("images");
  if (values.some((value) => typeof value === "string")) {
    throw new Error("One or more selected images are invalid.");
  }
  const files = values.filter(
    (value): value is File => value instanceof File && value.name.length > 0,
  );
  const captionsValue = formData.get("newImageCaptions");
  if (captionsValue !== null && typeof captionsValue !== "string") {
    throw new Error("Image captions must be provided as text.");
  }
  const captions = typeof captionsValue === "string" && captionsValue.length
    ? captionsValue.split(/\r?\n/)
    : [];
  if (captions.length && captions.length !== files.length) {
    throw new Error("Provide one caption line per newly selected image.");
  }

  const prepared: PreparedArticleImage[] = [];
  for (const [position, file] of files.entries()) {
    if (!file.size || file.size > maximumImageBytes) {
      throw new Error("Each article image must be larger than zero and no more than 10 MB.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    let format: "jpeg" | "png" | "webp" | undefined;
    try {
      const metadata = await sharp(buffer, {
        limitInputPixels: maximumImagePixels,
      }).metadata();
      if (
        metadata.format === "jpeg" ||
        metadata.format === "png" ||
        metadata.format === "webp"
      ) {
        format = metadata.format;
      }
      await sharp(buffer, { limitInputPixels: maximumImagePixels }).stats();
    } catch (error) {
      console.error("Unable to decode uploaded article image:", error);
      throw new Error("One or more selected files are not valid images.");
    }
    const mimeType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
    if (!format || file.type !== mimeType) {
      throw new Error("Upload valid JPEG, PNG, or WebP image files only.");
    }
    const extension = format === "jpeg" ? "jpg" : format;
    prepared.push({
      buffer,
      fileName: `${randomUUID()}.${extension}`,
      originalName:
        file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "image",
      mimeType,
      size: buffer.byteLength,
      caption: captions[position]?.trim().slice(0, 500) ?? "",
      position,
    });
  }
  return prepared;
}

export async function persistArticleImages(images: PreparedArticleImage[]) {
  await mkdir(articleImageDirectory, { recursive: true });
  const saved: string[] = [];
  try {
    for (const image of images) {
      await writeFile(resolve(articleImageDirectory, image.fileName), image.buffer, {
        flag: "wx",
      });
      saved.push(image.fileName);
    }
  } catch (error) {
    await removeArticleImageFiles(saved);
    throw error;
  }
  return saved;
}

export async function removeArticleImageFiles(fileNames: string[]) {
  await Promise.all(
    fileNames.map((fileName) =>
      rm(resolve(articleImageDirectory, fileName), { force: true }),
    ),
  );
}
