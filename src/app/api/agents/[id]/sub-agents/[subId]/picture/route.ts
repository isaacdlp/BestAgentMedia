import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string; subId: string }> };

const MAX_PICTURE_BYTES = 5 * 1024 * 1024; // 5 MB
const PICTURE_SIZE = 256; // resize to 256×256

export async function GET(_req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return new Response("Forbidden", { status: 403 });
  }
  const { id, subId } = await params;
  if (!/^[1-9]\d*$/.test(id) || !/^[1-9]\d*$/.test(subId)) {
    return new Response("Not found", { status: 404 });
  }

  const subAgent = await prisma.subAgent.findFirst({
    where: { id: Number(subId), agentId: Number(id) },
    select: { picturePath: true },
  });
  if (!subAgent?.picturePath) return new Response("No picture", { status: 404 });

  const filename = subAgent.picturePath.match(/^media\/sub-agents\/([a-z0-9._-]+)$/i)?.[1];
  if (!filename) return new Response("Not found", { status: 404 });

  try {
    const buffer = await readFile(resolve(process.cwd(), "media", "sub-agents", filename));
    const ext = extname(filename).toLowerCase();
    const mime = ext === ".png" ? "image/png" : "image/jpeg";
    return new Response(buffer, { headers: { "Content-Type": mime, "Cache-Control": "private, max-age=3600" } });
  } catch {
    return new Response("Not found", { status: 404 });
  }
}

export async function POST(req: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user || user.role !== UserRole.ADMIN) {
    return NextResponse.json({ error: "Admins only." }, { status: 403 });
  }
  const { id, subId } = await params;
  if (!/^[1-9]\d*$/.test(id) || !/^[1-9]\d*$/.test(subId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const existing = await prisma.subAgent.findFirst({
    where: { id: Number(subId), agentId: Number(id) },
    select: { id: true },
  });
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

  const mimeType = file.type;
  if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) {
    return NextResponse.json({ error: "Picture must be a JPEG, PNG, or WebP image." }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let processed: Buffer;
  try {
    processed = await sharp(buffer)
      .resize(PICTURE_SIZE, PICTURE_SIZE, { fit: "cover" })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    return NextResponse.json({ error: "Could not process image." }, { status: 400 });
  }

  const filename = `${subId}.jpg`;
  const dir = resolve(process.cwd(), "media", "sub-agents");
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, filename), processed);

  const picturePath = `media/sub-agents/${filename}`;
  await prisma.subAgent.update({
    where: { id: Number(subId) },
    data: { picturePath },
  });

  return NextResponse.json({ picturePath });
}
