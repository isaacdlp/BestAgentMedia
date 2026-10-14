import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

const imageDirectory = resolve(process.cwd(), "media", "publications");

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id) || !Number.isSafeInteger(Number(id))) {
    return new NextResponse("Not found", { status: 404 });
  }

  const publication = await prisma.publication.findUnique({
    where: { id: Number(id) },
    select: { coverImagePath: true },
  });
  const filename = publication?.coverImagePath?.match(
    /^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i,
  )?.[1];
  if (!filename) {
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

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Cache-Control": "public, max-age=3600",
      "Content-Length": String(image.byteLength),
      "Content-Type": filename.toLowerCase().endsWith(".png")
        ? "image/png"
        : "image/jpeg",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
