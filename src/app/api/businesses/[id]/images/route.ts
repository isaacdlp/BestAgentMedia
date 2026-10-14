import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prepareBusinessImages, persistBusinessImages } from "@/lib/business-images";
import { prisma } from "@/lib/db";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const businessId = Number(id);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, ownerUserId: true },
  });
  if (!business) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const isOwner = business.ownerUserId === user.id;
  if (user.role !== UserRole.ADMIN && !isOwner) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data." }, { status: 400 });
  }

  let images;
  try {
    images = await prepareBusinessImages(formData);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Invalid images." }, { status: 422 });
  }

  if (!images.length) return NextResponse.json({ error: "No images provided." }, { status: 400 });

  const currentCount = await prisma.businessImage.count({ where: { businessId } });
  if (currentCount + images.length > 5) {
    return NextResponse.json({ error: "A business can have at most 5 images." }, { status: 422 });
  }

  await persistBusinessImages(images);

  await prisma.businessImage.createMany({
    data: images.map((img, i) => ({
      businessId,
      fileName: img.fileName,
      originalName: img.originalName,
      mimeType: img.mimeType,
      size: img.size,
      position: currentCount + i,
    })),
  });

  revalidatePath(`/businesses/${businessId}`);
  return NextResponse.json({ count: images.length }, { status: 201 });
}
