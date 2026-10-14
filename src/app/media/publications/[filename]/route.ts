import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { getPublicationScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const imageDirectory = resolve(process.cwd(), "media", "publications");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ filename: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { filename } = await params;
  if (!/^[a-z0-9-]+\.(?:png|jpe?g)$/i.test(filename)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const scope = await getPublicationScope(user);
  if (!scope) {
    return new NextResponse("Not found", { status: 404 });
  }

  const mediaPath = `media/publications/${filename}`;
  const publicationRecords = await prisma.$queryRaw<Array<{ id: number }>>`
    SELECT "id"
    FROM "Publication"
    WHERE "coverImagePath" = ${mediaPath}
  `;
  const publication = publicationRecords[0]
    ? await prisma.publication.findFirst({
        where: { id: publicationRecords[0].id, ...scope },
        select: { id: true },
      })
    : null;
  if (!publication) {
    return new NextResponse("Not found", { status: 404 });
  }

  let image: Buffer;
  try {
    image = await readFile(resolve(imageDirectory, filename));
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return new NextResponse("Not found", { status: 404 });
    }
    throw error;
  }

  const contentType = filename.toLowerCase().endsWith(".png")
    ? "image/png"
    : "image/jpeg";
  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Cache-Control": "private, max-age=3600",
      "Content-Length": String(image.byteLength),
      "Content-Type": contentType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}
