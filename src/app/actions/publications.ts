"use server";

import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { UserRole } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import sharp from "sharp";
import { z } from "zod";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export type PublicationActionState = {
  error?: string;
};

const maximumCoverImageBytes = 10 * 1024 * 1024;
const maximumCoverImagePixels = 40_000_000;
const minimumCoverImageWidth = 300;
const minimumCoverImageHeight = 400;
const mediaDirectory = resolve(process.cwd(), "media", "publications");

const updatePublicationSchema = z.object({
  id: z
    .string()
    .regex(/^[1-9]\d*$/)
    .transform(Number)
    .pipe(z.number().int().positive().safe()),
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .min(1)
    .max(200)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  description: z.string().trim().max(5000),
  zipCodes: z
    .string()
    .transform((value) => [
      ...new Set(
        value
          .split(/[\s,]+/)
          .map((code) => code.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.string().regex(/^\d{5}$/)).min(1)),
});

export async function updatePublication(
  _previousState: PublicationActionState,
  formData: FormData,
): Promise<PublicationActionState> {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const parsedPublication = updatePublicationSchema.safeParse({
    id: formData.get("id"),
    name: formData.get("name"),
    slug: formData.get("slug"),
    description: formData.get("description") ?? "",
    zipCodes: formData.get("zipCodes"),
  });
  if (!parsedPublication.success) {
    return {
      error:
        parsedPublication.error.issues[0]?.message ??
        "Check the publication details and try again.",
    };
  }
  const publication = parsedPublication.data;

  const previousCoverRecords = await prisma.$queryRaw<
    Array<{ coverImagePath: string | null }>
  >`
    SELECT "coverImagePath"
    FROM "Publication"
    WHERE "id" = ${publication.id}
  `;
  if (previousCoverRecords.length === 0) {
    return {
      error: "This publication no longer exists. Refresh the page and try again.",
    };
  }
  const previousCoverPath = previousCoverRecords[0].coverImagePath;

  const upload = formData.get("coverImage");
  let newCoverPath: string | null = null;
  let newCoverFilePath: string | null = null;
  if (upload instanceof File && upload.name) {
    const validationError = await validateCoverImage(upload);
    if (validationError instanceof Error) {
      return { error: validationError.message };
    }
    const fileName = `publication-${publication.id}-${randomUUID()}.${validationError.extension}`;
    newCoverPath = `media/publications/${fileName}`;
    newCoverFilePath = resolve(mediaDirectory, fileName);
    await mkdir(mediaDirectory, { recursive: true });
    await writeFile(newCoverFilePath, validationError.buffer, { flag: "wx" });
  } else if (upload !== null && !(upload instanceof File)) {
    return { error: "The selected cover upload is not a valid file." };
  }

  const removeCover = formData.get("removeCoverImage") === "on";
  const coverImagePath = newCoverPath ?? (removeCover ? null : previousCoverPath);

  try {
    await prisma.$transaction(async (transaction) => {
      for (const code of publication.zipCodes) {
        await transaction.zipCode.upsert({
          where: { code },
          update: {},
          create: { code },
        });
      }

      await transaction.publication.update({
        where: { id: publication.id },
        data: {
          name: publication.name,
          slug: publication.slug,
          description: publication.description || null,
          zipCodes: {
            set: publication.zipCodes.map((code) => ({ code })),
          },
        },
      });

      await transaction.$executeRaw`
        UPDATE "Publication"
        SET "coverImagePath" = ${coverImagePath}
        WHERE "id" = ${publication.id}
      `;
    });
  } catch (error) {
    if (newCoverFilePath) {
      await rm(newCoverFilePath, { force: true });
    }
    throw error;
  }

  if (previousCoverPath && previousCoverPath !== coverImagePath) {
    await removeManagedCoverFile(previousCoverPath);
  }

  revalidatePath("/publications");
  revalidatePath(`/publications/${publication.id}`);
  redirect(`/publications/${publication.id}`);
}

async function validateCoverImage(file: File) {
  if (file.size > maximumCoverImageBytes) {
    return new Error("Cover images must be 10 MB or smaller.");
  }

  if (file.type !== "image/png" && file.type !== "image/jpeg") {
    return new Error(
      "Upload a PNG or JPEG image. Other file formats are not accepted.",
    );
  }

  const input = Buffer.from(await file.arrayBuffer());
  try {
    const image = sharp(input, { limitInputPixels: maximumCoverImagePixels });
    const metadata = await image.metadata();
    const expectedFormat = file.type === "image/png" ? "png" : "jpeg";
    if (metadata.format !== expectedFormat) {
      return new Error(
        "The selected file contents do not match its PNG or JPEG image type.",
      );
    }

    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height) {
      return new Error("The uploaded image has no valid dimensions.");
    }
    const swapsDimensions =
      metadata.orientation !== undefined &&
      metadata.orientation >= 5 &&
      metadata.orientation <= 8;
    const orientedWidth = swapsDimensions ? height : width;
    const orientedHeight = swapsDimensions ? width : height;
    if (
      orientedWidth < minimumCoverImageWidth ||
      orientedHeight < minimumCoverImageHeight
    ) {
      return new Error("Cover images must be at least 300 × 400 pixels.");
    }

    const normalized = await image
      .rotate()
      .toFormat(expectedFormat, {
        ...(expectedFormat === "jpeg"
          ? { quality: 88, mozjpeg: true }
          : { compressionLevel: 9 }),
      })
      .toBuffer();
    if (normalized.byteLength > maximumCoverImageBytes) {
      return new Error("The processed cover image exceeds the 10 MB limit.");
    }

    return {
      buffer: normalized,
      extension: expectedFormat === "jpeg" ? "jpg" : "png",
    };
  } catch {
    return new Error(
      "The uploaded file could not be decoded as a valid PNG or JPEG image.",
    );
  }
}

async function removeManagedCoverFile(coverPath: string) {
  const match =
    /^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i.exec(coverPath);
  if (!match) {
    console.error(
      `Refusing to remove a cover file outside the publication media directory: ${coverPath}`,
    );
    return;
  }
  await rm(resolve(mediaDirectory, match[1]), { force: true });
}
