import { NextResponse } from "next/server";
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { getAdvertisementScope } from "@/lib/access";
import { prisma } from "@/lib/db";
import { launchGenerateAd } from "@/lib/creative-agent";

export const maxDuration = 300;

export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to generate ads." }, { status: 401 });
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "Administrators and editors only." }, { status: 403 });
  }

  let body: {
    adId?: unknown;
    imageIds?: unknown;
    customInstructions?: unknown;
    iterateFromTaskId?: unknown;
    /** Defaults to true: the advertiser's reviews of the ad are given to the Creative. */
    includeReviews?: unknown;
  };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }

  const { adId, imageIds, customInstructions, iterateFromTaskId } = body;
  const includeReviews = body.includeReviews !== false;

  if (typeof adId !== "string" || !/^[\w-]{1,64}$/.test(adId)) {
    return NextResponse.json({ error: "Invalid adId." }, { status: 400 });
  }
  if (iterateFromTaskId !== undefined && (typeof iterateFromTaskId !== "string" || !/^[\w-]{1,64}$/.test(iterateFromTaskId))) {
    return NextResponse.json({ error: "Invalid iterateFromTaskId." }, { status: 400 });
  }
  // An iteration revises the previous ad, so its reference images are optional.
  const iterating = typeof iterateFromTaskId === "string";
  if (!Array.isArray(imageIds) || (!iterating && imageIds.length === 0) || imageIds.length > 20) {
    return NextResponse.json({ error: "Select between 1 and 20 images." }, { status: 400 });
  }
  if (!imageIds.every((id): id is string => typeof id === "string" && /^[\w-]{1,64}$/.test(id))) {
    return NextResponse.json({ error: "Invalid imageIds." }, { status: 400 });
  }

  const custom = typeof customInstructions === "string" ? customInstructions.slice(0, 2000) : "";

  const scope = await getAdvertisementScope(user);
  if (!scope) return NextResponse.json({ error: "Forbidden." }, { status: 403 });

  const publicationSelect = {
    id: true,
    name: true,
    description: true,
    zipCodes: { orderBy: { code: "asc" }, select: { code: true } },
  } as const;
  const ad = await prisma.advertisement.findFirst({
    where: { id: adId, ...scope },
    select: {
      id: true,
      title: true,
      description: true,
      styleName: true,
      creativeFileName: true,
      promotionPackage: { select: { name: true, description: true, publication: { select: publicationSelect } } },
      business: {
        select: {
          name: true,
          description: true,
          primaryCategory: true,
          categories: true,
          addressLabel: true,
          houseNumber: true,
          street: true,
          city: true,
          stateCode: true,
          postalCode: true,
          phone: true,
          email: true,
          website: true,
        },
      },
      issues: {
        orderBy: { issue: { publicationDate: "asc" } },
        select: {
          issue: { select: { name: true, description: true, publicationDate: true, publication: { select: publicationSelect } } },
        },
      },
    },
  });
  if (!ad) return NextResponse.json({ error: "Advertisement not found." }, { status: 404 });

  // The rate the ad was priced on is authoritative; the stored style name covers rates deleted since.
  // Without a style (or a size in the instructions) the Creative prints a half page.
  const styleName = ad.promotionPackage?.name ?? ad.styleName;

  const images = await prisma.adImage.findMany({
    where: { id: { in: imageIds as string[] }, advertisementId: adId },
    select: { id: true, fileName: true, mimeType: true, originalName: true },
  });
  if (!iterating && images.length !== imageIds.length) {
    return NextResponse.json({ error: "One or more images not found for this ad." }, { status: 404 });
  }

  const reviews = includeReviews
    ? await prisma.adReview.findMany({
        where: { advertisementId: adId },
        orderBy: [{ createdAt: "asc" }, { id: "asc" }],
        select: { decision: true, comments: true, creativeFileName: true, createdAt: true },
      })
    : [];

  try {
    const { business } = ad;
    const streetLine = [business.houseNumber, business.street].filter(Boolean).join(" ");
    const cityLine = [business.city, [business.stateCode, business.postalCode].filter(Boolean).join(" ")].filter(Boolean).join(", ");
    const publications = new Map<number, (typeof ad.issues)[number]["issue"]["publication"]>();
    if (ad.promotionPackage) publications.set(ad.promotionPackage.publication.id, ad.promotionPackage.publication);
    for (const { issue } of ad.issues) publications.set(issue.publication.id, issue.publication);

    const task = await launchGenerateAd({
      context: {
        ad: { id: ad.id, title: ad.title, description: ad.description },
        style: styleName
          ? {
              name: styleName,
              description: ad.promotionPackage?.description ?? null,
              publicationName: ad.promotionPackage?.publication.name ?? null,
            }
          : null,
        business: {
          name: business.name,
          description: business.description,
          primaryCategory: business.primaryCategory,
          categories: business.categories,
          address: business.addressLabel?.trim() || [streetLine, cityLine].filter(Boolean).join(", ") || null,
          phone: business.phone,
          email: business.email,
          website: business.website,
        },
        publications: [...publications.values()].map((p) => ({
          name: p.name,
          description: p.description,
          zipCodes: p.zipCodes.map((z) => z.code),
        })),
        issues: ad.issues.map(({ issue }) => ({
          name: issue.name,
          publicationName: issue.publication.name,
          publicationDate: issue.publicationDate.toISOString().slice(0, 10),
          description: issue.description,
        })),
        reviews: reviews.map((review, index) => ({
          number: index + 1,
          date: review.createdAt.toISOString().slice(0, 10),
          decision: review.decision,
          comments: review.comments,
          onCurrentArtwork: Boolean(review.creativeFileName) && review.creativeFileName === ad.creativeFileName,
        })),
      },
      images,
      customInstructions: custom,
      triggeredById: user.id,
      ...(typeof iterateFromTaskId === "string" ? { iterateFromTaskId } : {}),
    });
    return NextResponse.json({ task }, { status: 202 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ad generation could not be started.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
