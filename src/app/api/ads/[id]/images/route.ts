import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { getAdvertisementScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prepareAdImages, persistAdImages } from "@/lib/ad-images";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "Admins and editors only." }, { status: 403 });
  }

  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const scope = await getAdvertisementScope(user);
  if (!scope) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const ad = await prisma.advertisement.findFirst({ where: { id, ...scope }, select: { id: true } });
  if (!ad) return NextResponse.json({ error: "Not found." }, { status: 404 });

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  let images;
  try {
    images = await prepareAdImages(formData);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid images." }, { status: 422 });
  }

  if (!images.length) return NextResponse.json({ error: "No images provided." }, { status: 400 });

  const currentCount = await prisma.adImage.count({ where: { advertisementId: id } });
  if (currentCount + images.length > 20) {
    return NextResponse.json({ error: "An ad can have at most 20 images." }, { status: 422 });
  }

  await persistAdImages(images);

  await prisma.adImage.createMany({
    data: images.map((img, i) => ({
      advertisementId: id,
      fileName: img.fileName,
      originalName: img.originalName,
      mimeType: img.mimeType,
      size: img.size,
      position: currentCount + i,
    })),
  });

  revalidatePath(`/ads/${id}`);
  return NextResponse.json({ count: images.length }, { status: 201 });
}
