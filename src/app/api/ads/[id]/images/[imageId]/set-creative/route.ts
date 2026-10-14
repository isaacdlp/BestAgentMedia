import { copyFile, mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { getAdvertisementScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { adImageDirectory } from "@/lib/ad-images";
import { adCreativeDirectory } from "@/lib/ad-creative";
import { prisma } from "@/lib/db";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "Admins and editors only." }, { status: 403 });
  }

  const scope = await getAdvertisementScope(user);
  if (!scope) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id, imageId } = await params;
  if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const ad = await prisma.advertisement.findFirst({
    where: { id, ...scope },
    select: { id: true, creativeFileName: true },
  });
  if (!ad) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const image = await prisma.adImage.findFirst({
    where: { id: imageId, advertisementId: id },
    select: { id: true, fileName: true, mimeType: true, originalName: true, size: true },
  });
  if (!image) return NextResponse.json({ error: "Image not found." }, { status: 404 });

  if (!/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(image.fileName)) {
    return NextResponse.json({ error: "Invalid image file." }, { status: 500 });
  }

  const ext = image.fileName.split(".").pop() ?? "jpg";
  const newFileName = `${randomUUID()}.${ext}`;
  const srcPath = resolve(adImageDirectory, image.fileName);
  const destPath = resolve(adCreativeDirectory, newFileName);

  await mkdir(adCreativeDirectory, { recursive: true });
  await copyFile(srcPath, destPath);

  const oldFileName = ad.creativeFileName;

  await prisma.advertisement.update({
    where: { id: ad.id },
    data: {
      creativeFileName: newFileName,
      creativeMimeType: image.mimeType,
      creativeSize: image.size,
      creativeOriginalName: image.originalName,
      creativeImageId: image.id,
    },
  });

  if (oldFileName && oldFileName !== newFileName) {
    await rm(resolve(adCreativeDirectory, oldFileName), { force: true });
  }

  revalidatePath(`/ads/${id}`);
  return NextResponse.json({ ok: true }, { status: 200 });
}
