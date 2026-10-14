import { access, copyFile, mkdir, readFile, readdir } from "node:fs/promises";
import { basename, dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { PrismaClient } from "@prisma/client";

const prismaDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = resolve(prismaDirectory, "seed", "publications");
const mediaDirectory = resolve(prismaDirectory, "..", "media", "publications");
const imageExtensions = new Set([".jpeg", ".jpg", ".png"]);

export async function seedPublications(prisma: PrismaClient) {
  await mkdir(mediaDirectory, { recursive: true });

  const zipPublicationData = JSON.parse(
    await readFile(resolve(sourceDirectory, "zips.json"), "utf8"),
  ) as [string, string[]][];
  const publicationZipCodes = new Map<string, Set<string>>();

  for (const [code, publicationNames] of zipPublicationData) {
    for (const name of publicationNames) {
      const codes = publicationZipCodes.get(name) ?? new Set<string>();
      codes.add(code);
      publicationZipCodes.set(name, codes);
    }
  }

  const descriptions = JSON.parse(
    await readFile(resolve(sourceDirectory, "descriptions.json"), "utf8"),
  ) as Record<string, string>;

  const sourceFiles = await readdir(sourceDirectory);
  const coverImages = new Map(
    sourceFiles
      .filter((filename) => imageExtensions.has(extname(filename).toLowerCase()))
      .map((filename) => [basename(filename, extname(filename)), filename]),
  );
  const publications = [...publicationZipCodes.entries()].map(([name, codes]) => ({
    name,
    zipCodes: [...codes],
    coverImage: coverImages.get(name),
  }));
  const zipCodes = [...new Set(zipPublicationData.map(([code]) => code))];

  for (const code of zipCodes) {
    await prisma.zipCode.upsert({
      where: { code },
      update: {},
      create: { code },
    });
  }

  const publicationsWithoutCovers: string[] = [];
  const publicationsSkippedForSlugConflict: string[] = [];
  for (const { name, zipCodes: codes, coverImage } of publications) {
    const existingPublication = await prisma.publication.findUnique({
      where: { name },
      select: { id: true, description: true },
    });
    const description = descriptions[name] ?? null;
    const slug = slugify(name);
    const publicationWithSlug = await prisma.publication.findUnique({
      where: { slug },
      select: { name: true },
    });
    if (publicationWithSlug && publicationWithSlug.name !== name) {
      publicationsSkippedForSlugConflict.push(name);
      continue;
    }

    let coverImagePath: string | null = null;
    if (coverImage) {
      const sourcePath = resolve(sourceDirectory, coverImage);
      const destinationName = `${slug}${extname(coverImage).toLowerCase()}`;
      const destinationPath = resolve(mediaDirectory, destinationName);
      coverImagePath = `media/publications/${destinationName}`;

      let destinationExists = true;
      try {
        await access(destinationPath);
      } catch (error) {
        if (
          typeof error !== "object" ||
          error === null ||
          !("code" in error) ||
          error.code !== "ENOENT"
        ) {
          throw error;
        }
        destinationExists = false;
      }
      if (!destinationExists) {
        await copyFile(sourcePath, destinationPath);
      }
    } else {
      publicationsWithoutCovers.push(name);
    }

    await prisma.publication.upsert({
      where: { name },
      update: {
        slug,
        // Never overwrite a description an administrator has already written.
        ...(existingPublication?.description ? {} : { description }),
        zipCodes: {
          set: codes.map((code) => ({ code })),
        },
      },
      create: {
        name,
        slug,
        description,
        coverImagePath,
        zipCodes: {
          connect: codes.map((code) => ({ code })),
        },
      },
    });

    if (!existingPublication) {
      await prisma.$executeRaw`
        UPDATE "Publication"
        SET "coverImagePath" = ${coverImagePath}
        WHERE "name" = ${name}
      `;
    }
  }

  console.info(
    `Seeded ${publications.length} publications from ${zipPublicationData.length} ZIP mappings.`,
  );
  if (publicationsWithoutCovers.length > 0) {
    console.warn(`No matching cover images found for: ${publicationsWithoutCovers.join(", ")}.`);
  }
  if (publicationsSkippedForSlugConflict.length > 0) {
    console.warn(
      `Skipped publications whose slugs are already assigned to another publication: ${publicationsSkippedForSlugConflict.join(", ")}.`,
    );
  }
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}
