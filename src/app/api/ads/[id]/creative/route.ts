import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { getAdvertisementScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { adCreativeDirectory, prepareCreative, persistCreative, removeCreativeFile } from "@/lib/ad-creative";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const scope = await getAdvertisementScope(user);
  if (!scope) return new NextResponse("Forbidden", { status: 403 });

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) return new NextResponse("Not found", { status: 404 });

  const ad = await prisma.advertisement.findFirst({
    where: { id, ...scope },
    select: { creativeFileName: true, creativeMimeType: true },
  });
  if (!ad?.creativeFileName || !ad.creativeMimeType) {
    return new NextResponse("Not found", { status: 404 });
  }
  if (!/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(ad.creativeFileName)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let file: Buffer;
  try {
    file = await readFile(resolve(adCreativeDirectory, ad.creativeFileName));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return new NextResponse("Not found", { status: 404 });
    }
    throw error;
  }

  return new NextResponse(new Uint8Array(file), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(file.byteLength),
      "Content-Type": ad.creativeMimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "Admins and editors only." }, { status: 403 });
  }

  const scope = await getAdvertisementScope(user);
  if (!scope) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ad = await prisma.advertisement.findFirst({
    where: { id, ...scope },
    select: { id: true, creativeFileName: true },
  });
  if (!ad) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  const file = formData.get("creative");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided." }, { status: 400 });
  }

  let creative;
  try {
    creative = await prepareCreative(file);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid image." }, { status: 422 });
  }

  const oldFileName = ad.creativeFileName;

  await persistCreative(creative);
  await prisma.advertisement.update({
    where: { id: ad.id },
    data: {
      creativeFileName: creative.fileName,
      creativeMimeType: creative.mimeType,
      creativeSize: creative.size,
      creativeOriginalName: creative.originalName,
    },
  });

  if (oldFileName) await removeCreativeFile(oldFileName);

  revalidatePath(`/ads/${id}`);
  return NextResponse.json({ ok: true }, { status: 201 });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "Admins and editors only." }, { status: 403 });
  }

  const scope = await getAdvertisementScope(user);
  if (!scope) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const ad = await prisma.advertisement.findFirst({
    where: { id, ...scope },
    select: { id: true, creativeFileName: true },
  });
  if (!ad) return NextResponse.json({ error: "Not found." }, { status: 404 });

  if (!ad.creativeFileName) return new NextResponse(null, { status: 204 });

  const fileName = ad.creativeFileName;
  await prisma.advertisement.update({
    where: { id: ad.id },
    data: { creativeFileName: null, creativeMimeType: null, creativeSize: null, creativeOriginalName: null },
  });
  await removeCreativeFile(fileName);

  revalidatePath(`/ads/${id}`);
  return new NextResponse(null, { status: 204 });
}
