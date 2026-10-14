import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { businessImageDirectory, removeBusinessImageFiles } from "@/lib/business-images";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { id, imageId } = await params;
  if (!/^[1-9]\d*$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) {
    return new NextResponse("Not found", { status: 404 });
  }
  const businessId = Number(id);

  // Admins, publishers, and the business owner can view images
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerUserId: true },
    });
    if (!business || business.ownerUserId !== user.id) {
      return new NextResponse("Forbidden", { status: 403 });
    }
  }

  const imageRecord = await prisma.businessImage.findFirst({
    where: { id: imageId, businessId },
    select: { fileName: true, mimeType: true },
  });
  if (!imageRecord || !/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(imageRecord.fileName)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let image: Buffer;
  try {
    image = await readFile(resolve(businessImageDirectory, imageRecord.fileName));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return new NextResponse("Not found", { status: 404 });
    }
    throw error;
  }

  return new NextResponse(new Uint8Array(image), {
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Length": String(image.byteLength),
      "Content-Type": imageRecord.mimeType,
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id, imageId } = await params;
  if (!/^[1-9]\d*$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  const businessId = Number(id);

  // Admins and the business owner can delete images
  if (user.role !== UserRole.ADMIN) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { ownerUserId: true },
    });
    if (!business || business.ownerUserId !== user.id) {
      return NextResponse.json({ error: "Not authorized." }, { status: 403 });
    }
  }

  const imageRecord = await prisma.businessImage.findFirst({
    where: { id: imageId, businessId },
    select: { id: true, fileName: true },
  });
  if (!imageRecord) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.businessImage.delete({ where: { id: imageRecord.id } });
  await removeBusinessImageFiles([imageRecord.fileName]);

  revalidatePath(`/businesses/${businessId}`);
  return new NextResponse(null, { status: 204 });
}
