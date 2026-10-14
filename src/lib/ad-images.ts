import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

export const adImageDirectory = resolve(process.cwd(), "media", "ads");
const maximumImageBytes = 10 * 1024 * 1024;
const maximumImagePixels = 40_000_000;

export type PreparedAdImage = {
  buffer: Buffer;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
  position: number;
};

export async function prepareAdImages(formData: FormData): Promise<PreparedAdImage[]> {
  const values = formData.getAll("images");
  if (values.some((value) => typeof value === "string")) {
    throw new Error("One or more selected images are invalid.");
  }
  const files = values.filter(
    (value): value is File => value instanceof File && value.name.length > 0,
  );

  const prepared: PreparedAdImage[] = [];
  for (const [position, file] of files.entries()) {
    if (!file.size || file.size > maximumImageBytes) {
      throw new Error("Each image must be larger than zero and no more than 10 MB.");
    }
    const buffer = Buffer.from(await file.arrayBuffer());
    let format: "jpeg" | "png" | "webp" | undefined;
    try {
      const metadata = await sharp(buffer, { limitInputPixels: maximumImagePixels }).metadata();
      if (metadata.format === "jpeg" || metadata.format === "png" || metadata.format === "webp") {
        format = metadata.format;
      }
      await sharp(buffer, { limitInputPixels: maximumImagePixels }).stats();
    } catch (error) {
      console.error("Unable to decode uploaded ad image:", error);
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
      originalName: file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "image",
      mimeType,
      size: buffer.byteLength,
      position,
    });
  }
  return prepared;
}

export async function persistAdImages(images: PreparedAdImage[]) {
  await mkdir(adImageDirectory, { recursive: true });
  const saved: string[] = [];
  try {
    for (const image of images) {
      await writeFile(resolve(adImageDirectory, image.fileName), image.buffer, { flag: "wx" });
      saved.push(image.fileName);
    }
  } catch (error) {
    await removeAdImageFiles(saved);
    throw error;
  }
  return saved;
}

export async function removeAdImageFiles(fileNames: string[]) {
  await Promise.all(
    fileNames.map((fileName) => rm(resolve(adImageDirectory, fileName), { force: true })),
  );
}
