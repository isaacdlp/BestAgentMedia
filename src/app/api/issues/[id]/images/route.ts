import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { getIssueScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const maximumImageBytes = 10 * 1024 * 1024;
const maximumImagePixels = 40_000_000;
const issueMediaDirectory = resolve(process.cwd(), "media", "issues");
const supportedImageFormats = {
  jpeg: { extension: "jpg", mimeType: "image/jpeg" },
  png: { extension: "png", mimeType: "image/png" },
  webp: { extension: "webp", mimeType: "image/webp" },
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Sign in to add images." }, { status: 401 });
  }
  if (user.role !== "ADMIN" && user.role !== "PUBLISHER") {
    return NextResponse.json({ error: "You cannot edit issue layouts." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }
  const scope = await getIssueScope(user);
  if (!scope) {
    return NextResponse.json({ error: "You cannot edit issue layouts." }, { status: 403 });
  }
  const issue = await prisma.issue.findFirst({
    where: { id, ...scope },
    select: { id: true },
  });
  if (!issue) {
    return NextResponse.json({ error: "Issue not found." }, { status: 404 });
  }

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maximumImageBytes + 64 * 1024) {
    return NextResponse.json({ error: "Choose an image no larger than 10 MB." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Choose a valid image file." }, { status: 400 });
  }
  const file = formData.get("image");
  if (!(file instanceof File) || file.size === 0 || file.size > maximumImageBytes) {
    return NextResponse.json({ error: "Choose an image no larger than 10 MB." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  let format: (typeof supportedImageFormats)[keyof typeof supportedImageFormats] | null;
  try {
    const image = sharp(buffer, { limitInputPixels: maximumImagePixels });
    const metadata = await image.metadata();
    format =
      metadata.format && metadata.format in supportedImageFormats
        ? supportedImageFormats[metadata.format as keyof typeof supportedImageFormats]
        : null;
    await image.stats();
  } catch (error) {
    console.error("Unable to decode uploaded issue image:", error);
    return NextResponse.json({ error: "The selected file could not be decoded as an image." }, { status: 400 });
  }
  if (!format || file.type !== format.mimeType) {
    return NextResponse.json({ error: "Upload a valid JPEG, PNG, or WebP image." }, { status: 400 });
  }

  const fileName = `${randomUUID()}.${format.extension}`;
  const directory = resolve(issueMediaDirectory, issue.id);
  await mkdir(directory, { recursive: true });
  await writeFile(resolve(directory, fileName), buffer, { flag: "wx" });

  return NextResponse.json({
    url: `/api/issues/${issue.id}/images/${fileName}`,
    name: file.name.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 255) || "Image",
  });
}
