import { readFile, writeFile, mkdir, unlink } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const MAX_PICTURE_BYTES = 5 * 1024 * 1024; // 5 MB
const PICTURE_SIZE = 256;
const PATH_PATTERN = /^media\/users\/([a-z0-9._-]+)$/i;

export async function GET(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return new Response("Forbidden", { status: 403 });
  const { id } = await params;

  const target = await prisma.user.findUnique({ where: { id }, select: { picturePath: true } });
  if (!target?.picturePath) return new Response("No picture", { status: 404 });

  const filename = target.picturePath.match(PATH_PATTERN)?.[1];
  if (!filename) return new Response("Not found", { status: 404 });

  try {
    const buffer = await readFile(resolve(process.cwd(), "media", "users", filename));
    const mime = extname(filename).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
    return new Response(buffer, { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function POST(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  const { id } = await params;
  if (!user || (user.id !== id && user.role !== UserRole.ADMIN)) {
    return NextResponse.json({ error: "Not allowed." }, { status: 403 });
  }

  const existing = await prisma.user.findUnique({ where: { id }, select: { picturePath: true } });
  if (!existing) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("picture");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Provide a picture file." }, { status: 400 });
  }
  if (file.size > MAX_PICTURE_BYTES) {
    return NextResponse.json({ error: "Picture must be under 5 MB." }, { status: 413 });
  }
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
    return NextResponse.json({ error: "Picture must be a JPEG, PNG, or WebP image." }, { status: 400 });
  }

  let processed: Buffer;
  try {
    processed = await sharp(Buffer.from(await file.arrayBuffer()))
      .resize(PICTURE_SIZE, PICTURE_SIZE, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Could not process image." }, { status: 400 });
  }

  // Unique filename per upload so cached copies are never stale.
  const filename = `${id}-${Date.now()}.jpg`;
  const dir = resolve(process.cwd(), "media", "users");
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, filename), processed);

  const picturePath = `media/users/${filename}`;
  await prisma.user.update({ where: { id }, data: { picturePath } });

  const oldFilename = existing.picturePath?.match(PATH_PATTERN)?.[1];
  if (oldFilename) await unlink(resolve(dir, oldFilename)).catch(() => undefined);

  return NextResponse.json({ picturePath });
}
