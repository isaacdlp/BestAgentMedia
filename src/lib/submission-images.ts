import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

export const maximumSubmissionImages = 5;
export const maximumSubmissionImageBytes = 10 * 1024 * 1024;

const maximumSubmissionImagePixels = 40_000_000;
export const submissionImageDirectory = resolve(
  process.cwd(),
  "media",
  "submissions",
);

const imageFormats = {
  jpeg: { extension: "jpg", mimeType: "image/jpeg" },
  png: { extension: "png", mimeType: "image/png" },
  webp: { extension: "webp", mimeType: "image/webp" },
} as const;

export type PreparedSubmissionImage = {
  buffer: Buffer;
  fileName: string;
  originalName: string;
  mimeType: string;
  size: number;
};

export async function prepareSubmissionImages(
  formData: FormData,
): Promise<PreparedSubmissionImage[]> {
  const uploads = formData.getAll("images");
  if (uploads.some((upload) => typeof upload === "string")) {
    throw new Error("One or more selected images are invalid.");
  }
  const files = uploads.filter(
    (upload): upload is File => upload instanceof File && upload.name.length > 0,
  );
  if (files.length > maximumSubmissionImages) {
    throw new Error("Choose no more than five images.");
  }

  const prepared: PreparedSubmissionImage[] = [];
  for (const file of files) {
    if (file.size > maximumSubmissionImageBytes) {
      throw new Error("Each image must be 10 MB or smaller.");
    }
    if (file.size === 0) {
      throw new Error("Selected images cannot be empty.");
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    let format: (typeof imageFormats)[keyof typeof imageFormats] | null = null;
    try {
      const metadata = await sharp(buffer, {
        limitInputPixels: maximumSubmissionImagePixels,
      }).metadata();
      format =
        metadata.format && metadata.format in imageFormats
          ? imageFormats[metadata.format as keyof typeof imageFormats]
          : null;
      await sharp(buffer, {
        limitInputPixels: maximumSubmissionImagePixels,
      }).stats();
    } catch (error) {
      console.error("Unable to decode uploaded submission image:", error);
      throw new Error(
        "One or more selected files could not be decoded as an image.",
      );
    }

    if (!format || file.type !== format.mimeType) {
      throw new Error("Upload valid JPEG, PNG, or WebP image files only.");
    }
    prepared.push({
      buffer,
      fileName: `${randomUUID()}.${format.extension}`,
      originalName:
        file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) ||
        "image",
      mimeType: format.mimeType,
      size: buffer.byteLength,
    });
  }
  return prepared;
}

export async function persistSubmissionImages(
  images: PreparedSubmissionImage[],
) {
  await mkdir(submissionImageDirectory, { recursive: true });
  const persistedFileNames: string[] = [];
  try {
    for (const image of images) {
      await writeFile(
        resolve(submissionImageDirectory, image.fileName),
        image.buffer,
        { flag: "wx" },
      );
      persistedFileNames.push(image.fileName);
    }
  } catch (error) {
    await removeSubmissionImageFiles(persistedFileNames);
    throw error;
  }
  return persistedFileNames;
}

export async function removeSubmissionImageFiles(fileNames: string[]) {
  await Promise.all(
    fileNames.map((fileName) =>
      rm(resolve(submissionImageDirectory, fileName), { force: true }),
    ),
  );
}
