import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

export const adCreativeDirectory = resolve(process.cwd(), "media", "ads-creative");
const maximumImageBytes = 20 * 1024 * 1024;
const maximumImagePixels = 40_000_000;

export type PreparedCreative = {
  buffer: Buffer;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export async function prepareCreative(file: File): Promise<PreparedCreative> {
  if (!file.size || file.size > maximumImageBytes) {
    throw new Error("Creative must be larger than zero and no more than 20 MB.");
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
    console.error("Unable to decode uploaded creative:", error);
    throw new Error("The selected file is not a valid image.");
  }
  const mimeType = format === "jpeg" ? "image/jpeg" : `image/${format}`;
  if (!format || file.type !== mimeType) {
    throw new Error("Upload a valid JPEG, PNG, or WebP image.");
  }
  const extension = format === "jpeg" ? "jpg" : format;
  return {
    buffer,
    fileName: `${randomUUID()}.${extension}`,
    originalName: file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "creative",
    mimeType,
    size: buffer.byteLength,
  };
}

export async function persistCreative(creative: PreparedCreative) {
  await mkdir(adCreativeDirectory, { recursive: true });
  await writeFile(resolve(adCreativeDirectory, creative.fileName), creative.buffer, { flag: "wx" });
}

export async function removeCreativeFile(fileName: string) {
  await rm(resolve(adCreativeDirectory, fileName), { force: true });
}
