import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { UserRole } from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { launchAgentTask } from "@/lib/agent-task-runner";
import {
  persistBusinessImages,
  prepareBusinessImageFromBuffer,
  removeBusinessImageFiles,
  type PreparedBusinessImage,
} from "@/lib/business-images";
import { downloadPlacePhoto, findPlaceWithPhotos, getGooglePlacesKey } from "@/lib/google-places";

const maximumImages = 5;

/** Launches a Task that imports up to 5 photos for the business from Google Places. */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const businessId = Number(id);

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: {
      id: true,
      name: true,
      ownerUserId: true,
      addressLabel: true,
      latitude: true,
      longitude: true,
      _count: { select: { images: true } },
    },
  });
  if (!business) return NextResponse.json({ error: "Not found." }, { status: 404 });
  if (user.role !== UserRole.ADMIN && business.ownerUserId !== user.id) {
    return NextResponse.json({ error: "Not authorized." }, { status: 403 });
  }

  try {
    getGooglePlacesKey();
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Google Places is not configured." }, { status: 422 });
  }
  if (business._count.images >= maximumImages) {
    return NextResponse.json({ error: `This business already has ${maximumImages} images. Remove one to import more.` }, { status: 422 });
  }

  let task;
  try {
    task = await launchAgentTask({
    agentId: null,
    label: `Import Google Places images: ${business.name}`,
    triggeredById: user.id,
    work: async ({ log }) => {
      const apiKey = getGooglePlacesKey();
      log("info", `Searching Google Places for “${business.name}”…`);
      const place = await findPlaceWithPhotos(apiKey, business);
      if (!place) throw new Error("No matching place was found on Google Places.");
      if (!place.photos.length) throw new Error(`Google Places has no photos for “${place.displayName}”.`);
      log("info", `Matched “${place.displayName}” with ${place.photos.length} photo(s).`);

      const currentCount = await prisma.businessImage.count({ where: { businessId } });
      const room = maximumImages - currentCount;
      if (room <= 0) throw new Error(`This business already has ${maximumImages} images.`);

      const prepared: PreparedBusinessImage[] = [];
      for (const photo of place.photos) {
        if (prepared.length >= room) break;
        try {
          const buffer = await downloadPlacePhoto(apiKey, photo.name);
          const label = `Google Places photo ${prepared.length + 1}${photo.attribution ? ` by ${photo.attribution}` : ""}`;
          prepared.push(await prepareBusinessImageFromBuffer(buffer, label, currentCount + prepared.length));
        } catch (error) {
          log("error", `Skipped a photo: ${error instanceof Error ? error.message : "download failed."}`);
        }
      }
      if (!prepared.length) throw new Error("None of the Google Places photos could be downloaded.");

      await persistBusinessImages(prepared);
      try {
        await prisma.businessImage.createMany({
          data: prepared.map((image) => ({
            businessId,
            fileName: image.fileName,
            originalName: image.originalName,
            mimeType: image.mimeType,
            size: image.size,
            position: image.position,
          })),
        });
      } catch (error) {
        await removeBusinessImageFiles(prepared.map((image) => image.fileName));
        throw error;
      }
      revalidatePath(`/businesses/${businessId}`);
      log("success", `Imported ${prepared.length} image(s) from Google Places.`);
      return { businessId, imported: prepared.length, source: "Google Places", placeId: place.id };
    },
    });
  } catch (error) {
    console.error("Failed to launch image import task", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The import task could not be started." },
      { status: 500 },
    );
  }

  return NextResponse.json({ task }, { status: 202 });
}
