import { UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getPublicationScope } from "@/lib/access";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import {
  buildPublicationMapData,
  findContainingZipCode,
} from "@/lib/zip-code-map";

const initialCandidateLimit = 200;
const expandedCandidateLimit = 2_000;

export async function GET(request: Request) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  let feature;

  if (code !== null) {
    if (!/^\d{5}$/.test(code)) {
      return NextResponse.json(
        { error: "Provide a valid five-digit ZIP code." },
        { status: 400 },
      );
    }

    const zipCode = await prisma.zipCode.findUnique({
      where: { code },
      select: { code: true, boundaryGeometry: true },
    });
    if (!zipCode?.boundaryGeometry) {
      return NextResponse.json(
        { error: "No ZIP code boundary was found for that ZIP code." },
        { status: 404 },
      );
    }
    feature = buildPublicationMapData([zipCode]).features[0];
  } else {
    const latitudeValue = url.searchParams.get("lat");
    const longitudeValue = url.searchParams.get("lng");
    const latitude = Number(latitudeValue);
    const longitude = Number(longitudeValue);
    if (
      latitudeValue === null ||
      longitudeValue === null ||
      !latitudeValue.trim() ||
      !longitudeValue.trim() ||
      !Number.isFinite(latitude) ||
      latitude < -90 ||
      latitude > 90 ||
      !Number.isFinite(longitude) ||
      longitude < -180 ||
      longitude > 180
    ) {
      return NextResponse.json(
        { error: "Provide a valid latitude and longitude." },
        { status: 400 },
      );
    }

    const candidates = await findNearestZipCandidates(
      latitude,
      longitude,
      initialCandidateLimit,
    );
    feature = findContainingZipCode(candidates, latitude, longitude);
    if (!feature) {
      const expandedCandidates = await findNearestZipCandidates(
        latitude,
        longitude,
        expandedCandidateLimit,
      );
      feature = findContainingZipCode(expandedCandidates, latitude, longitude);
    }
  }

  if (!feature) {
    return NextResponse.json(
      { error: "No ZIP code boundary was found at this location." },
      { status: 404 },
    );
  }

  const scope = await getPublicationScope(user);
  if (!scope) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const publications = await prisma.publication.findMany({
    where: {
      ...scope,
      zipCodes: { some: { code: feature.properties.code } },
    },
    orderBy: { name: "asc" },
    select: { id: true, name: true, coverImagePath: true },
  });

  return NextResponse.json({
    feature,
    publications: publications.map(({ coverImagePath, ...publication }) => ({
      ...publication,
      coverImageUrl: getCoverImageUrl(coverImagePath),
    })),
  });
}

function getCoverImageUrl(coverImagePath: string | null) {
  const fileName = coverImagePath?.match(
    /^media\/publications\/([a-z0-9-]+\.(?:png|jpe?g))$/i,
  )?.[1];
  return fileName ? `/media/publications/${encodeURIComponent(fileName)}` : null;
}

async function findNearestZipCandidates(
  latitude: number,
  longitude: number,
  limit: number,
) {
  return prisma.$queryRaw<Array<{ code: string; boundaryGeometry: unknown }>>`
    SELECT "code", "boundaryGeometry"
    FROM "ZipCode"
    WHERE "boundaryGeometry" IS NOT NULL
      AND "centroidLatitude" IS NOT NULL
      AND "centroidLongitude" IS NOT NULL
    ORDER BY
      POWER("centroidLatitude" - ${latitude}, 2) +
      POWER(
        ("centroidLongitude" - ${longitude}) *
          COS(RADIANS(${latitude})),
        2
      )
    LIMIT ${limit}
  `;
}
