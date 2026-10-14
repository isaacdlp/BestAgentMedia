import "server-only";

const searchUrl = "https://places.googleapis.com/v1/places:searchText";
const mediaHost = "https://places.googleapis.com/v1";
const requestTimeoutMs = 20_000;
const photoWidthPx = 1600;

export type PlacePhoto = { name: string; attribution: string | null };
export type PlaceMatch = { id: string; displayName: string; photos: PlacePhoto[] };

export function getGooglePlacesKey() {
  const key = process.env.GOOGLE_KEY;
  if (!key || key === "set-this-in-your-local-env-file") {
    throw new Error("Google Places API key (GOOGLE_KEY) is not configured.");
  }
  return key;
}

function nameTokens(value: string) {
  return value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !["the", "and", "inc", "llc", "ltd", "company"].includes(token));
}

/** Text Search (Places API New) biased to the business location; rejects results whose name does not match. */
export async function findPlaceWithPhotos(
  apiKey: string,
  business: { name: string; addressLabel: string | null; latitude: number | null; longitude: number | null },
): Promise<PlaceMatch | null> {
  const response = await fetch(searchUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Goog-Api-Key": apiKey,
      "X-Goog-FieldMask": "places.id,places.displayName,places.photos",
    },
    body: JSON.stringify({
      textQuery: [business.name, business.addressLabel].filter(Boolean).join(", "),
      pageSize: 3,
      ...(business.latitude !== null && business.longitude !== null
        ? {
            locationBias: {
              circle: { center: { latitude: business.latitude, longitude: business.longitude }, radius: 2000 },
            },
          }
        : {}),
    }),
    signal: AbortSignal.timeout(requestTimeoutMs),
  });
  const body = (await response.json().catch(() => null)) as {
    places?: Array<{
      id?: string;
      displayName?: { text?: string };
      photos?: Array<{ name?: string; authorAttributions?: Array<{ displayName?: string }> }>;
    }>;
    error?: { message?: string };
  } | null;
  if (!response.ok) {
    throw new Error(
      `Google Places rejected the request (HTTP ${response.status})${body?.error?.message ? `: ${body.error.message}` : "."}`,
    );
  }

  const wanted = new Set(nameTokens(business.name));
  for (const place of body?.places ?? []) {
    const displayName = place.displayName?.text ?? "";
    if (!place.id || !nameTokens(displayName).some((token) => wanted.has(token))) continue;
    const photos = (place.photos ?? []).flatMap((photo) =>
      photo.name
        ? [{ name: photo.name, attribution: photo.authorAttributions?.[0]?.displayName ?? null }]
        : [],
    );
    return { id: place.id, displayName, photos };
  }
  return null;
}

export async function downloadPlacePhoto(apiKey: string, photoName: string): Promise<Buffer> {
  // The media endpoint redirects to the image host; the key stays in the query string of the first hop only.
  const url = new URL(`${mediaHost}/${photoName}/media`);
  url.searchParams.set("maxWidthPx", String(photoWidthPx));
  url.searchParams.set("key", apiKey);
  const response = await fetch(url, { signal: AbortSignal.timeout(requestTimeoutMs) });
  if (!response.ok) {
    throw new Error(`Google Places photo download failed (HTTP ${response.status}).`);
  }
  return Buffer.from(await response.arrayBuffer());
}
