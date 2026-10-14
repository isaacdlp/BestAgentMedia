import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { getAdvertisementScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { adImageDirectory, removeAdImageFiles } from "@/lib/ad-images";
import { prisma } from "@/lib/db";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string; imageId: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const scope = await getAdvertisementScope(user);
  if (!scope) return new NextResponse("Forbidden", { status: 403 });

  const { id, imageId } = await params;
  if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const imageRecord = await prisma.adImage.findFirst({
    where: { id: imageId, advertisement: { is: { id, ...scope } } },
    select: { fileName: true, mimeType: true },
  });
  if (!imageRecord || !/^[\da-f-]{36}\.(?:jpg|png|webp)$/i.test(imageRecord.fileName)) {
    return new NextResponse("Not found", { status: 404 });
  }

  let image: Buffer;
  try {
    image = await readFile(resolve(adImageDirectory, imageRecord.fileName));
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
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    return NextResponse.json({ error: "Admins and publishers only." }, { status: 403 });
  }

  const scope = await getAdvertisementScope(user);
  if (!scope) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const { id, imageId } = await params;
  if (!/^[\w-]{1,64}$/.test(id) || !/^[\w-]{1,64}$/.test(imageId)) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const imageRecord = await prisma.adImage.findFirst({
    where: { id: imageId, advertisement: { is: { id, ...scope } } },
    select: { id: true, fileName: true },
  });
  if (!imageRecord) return NextResponse.json({ error: "Not found." }, { status: 404 });

  await prisma.adImage.delete({ where: { id: imageRecord.id } });
  await removeAdImageFiles([imageRecord.fileName]);

  revalidatePath(`/ads/${id}`);
  return new NextResponse(null, { status: 204 });
}
