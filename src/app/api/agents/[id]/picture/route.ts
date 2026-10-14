import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname } from "node:path";
import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import sharp from "sharp";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string }> };

const MAX_PICTURE_BYTES = 5 * 1024 * 1024; // 5 MB
const PICTURE_SIZE = 256; // resize to 256×256

export async function GET(_req: Request, { params }: Params) {
  // Pictures are shown to everyone on task screens; only uploading is restricted to admins.
  const user = await getCurrentUser();
  if (!user) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return new Response("Not found", { status: 404 });

  const agent = await prisma.agent.findUnique({
    where: { id: Number(id) },
    select: { picturePath: true },
  });
  if (!agent?.picturePath) return new Response("No picture", { status: 404 });

  const filename = agent.picturePath.match(/^media\/agents\/([a-z0-9._-]+)$/i)?.[1];
  if (!filename) return new Response("Not found", { status: 404 });

  try {
    const buffer = await readFile(resolve(process.cwd(), "media", "agents", filename));
    const mime = extname(filename).toLowerCase() === ".png" ? "image/png" : "image/jpeg";
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
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const existing = await prisma.agent.findUnique({ where: { id: Number(id) }, select: { id: true } });
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

  const filename = `${id}.jpg`;
  const dir = resolve(process.cwd(), "media", "agents");
  await mkdir(dir, { recursive: true });
  await writeFile(resolve(dir, filename), processed);

  const picturePath = `media/agents/${filename}`;
  await prisma.agent.update({ where: { id: Number(id) }, data: { picturePath } });

  return NextResponse.json({ picturePath });
}
