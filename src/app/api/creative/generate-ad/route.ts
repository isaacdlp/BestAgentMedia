import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { getAdvertisementScope } from "@/lib/access";
import { prisma } from "@/lib/db";
import { generateAd } from "@/lib/creative-agent";

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to generate ads." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) {
    return NextResponse.json({ error: "Administrators and publishers only." }, { status: 403 });
  }

  let body: { adId?: unknown; imageIds?: unknown; customInstructions?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { adId, imageIds, customInstructions } = body;

  if (typeof adId !== "string" || !/^[\w-]{1,64}$/.test(adId)) {
    return NextResponse.json({ error: "Invalid adId." }, { status: 400 });
  }
  if (!Array.isArray(imageIds) || imageIds.length === 0 || imageIds.length > 20) {
    return NextResponse.json({ error: "Select between 1 and 20 images." }, { status: 400 });
  }
  if (!imageIds.every((id): id is string => typeof id === "string" && /^[\w-]{1,64}$/.test(id))) {
    return NextResponse.json({ error: "Invalid imageIds." }, { status: 400 });
  }

  const custom = typeof customInstructions === "string" ? customInstructions.slice(0, 2000) : "";

  const scope = await getAdvertisementScope(user);
  if (!scope) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const ad = await prisma.advertisement.findFirst({
    where: { id: adId, ...scope },
    select: {
      id: true,
      title: true,
      description: true,
      cta: true,
      business: { select: { name: true, description: true } },
    },
  });
  if (!ad) return NextResponse.json({ error: "Advertisement not found." }, { status: 404 });

  const images = await prisma.adImage.findMany({
    where: { id: { in: imageIds as string[] }, advertisementId: adId },
    select: { id: true, fileName: true, mimeType: true, originalName: true },
  });
  if (images.length !== imageIds.length) {
    return NextResponse.json({ error: "One or more images not found for this ad." }, { status: 404 });
  }

  try {
    const taskId = await generateAd({
      adId,
      adTitle: ad.title,
      adDescription: ad.description,
      adCta: ad.cta,
      businessName: ad.business.name,
      businessDescription: ad.business.description,
      images,
      customInstructions: custom,
      triggeredById: user.id,
    });
    return NextResponse.json({ taskId }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Generation failed.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
