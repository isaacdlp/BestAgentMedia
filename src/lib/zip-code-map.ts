import "server-only";

type PolygonCoordinates = number[][][];

type PolygonGeometry = {
  type: "Polygon";
  coordinates: PolygonCoordinates;
};

type MultiPolygonGeometry = {
  type: "MultiPolygon";
  coordinates: PolygonCoordinates[];
};

type ZipCodeGeometry = PolygonGeometry | MultiPolygonGeometry;

type ZipCodeBoundary = {
  code: string;
  boundaryGeometry: unknown;
};

type PointLookupCandidate = ZipCodeBoundary;

export type PublicationZipFeature = {
  type: "Feature";
  properties: { code: string };
  geometry: ZipCodeGeometry;
};

export type PublicationMapData = {
  type: "FeatureCollection";
  features: PublicationZipFeature[];
  bounds: [[south: number, west: number], [north: number, east: number]];
  // ZIP codes left off the map: malformed, or without a valid Census boundary
  // (e.g. PO-box-only ZIPs).
  unmappedCodes: string[];
};

export function findContainingZipCode(
  candidates: PointLookupCandidate[],
  latitude: number,
  longitude: number,
): PublicationZipFeature | null {
  for (const { code, boundaryGeometry } of candidates) {
    if (!/^\d{5}$/.test(code)) {
      throw new Error("ZIP codes must be five-digit numeric codes.");
    }
    const geometry = parseGeometry(boundaryGeometry);
    if (geometryContainsPoint(geometry, longitude, latitude)) {
      return {
        type: "Feature",
        properties: { code },
        geometry,
      };
    }
  }
  return null;
}

export function geometryContainsCoordinate(
  boundaryGeometry: unknown,
  longitude: number,
  latitude: number,
) {
  return geometryContainsPoint(
    parseGeometry(boundaryGeometry),
    longitude,
    latitude,
  );
}

export function buildPublicationMapData(
  zipCodes: ZipCodeBoundary[],
): PublicationMapData {
  // Skip ZIPs with a malformed code or a missing/invalid boundary rather than
  // failing the whole map.
  const features: PublicationZipFeature[] = [];
  const unmappedCodes: string[] = [];
  for (const { code, boundaryGeometry } of zipCodes) {
    if (!/^\d{5}$/.test(code) || boundaryGeometry == null) {
      unmappedCodes.push(code);
      continue;
    }
    try {
      features.push({
        type: "Feature",
        properties: { code },
        geometry: parseGeometry(boundaryGeometry),
      });
    } catch (error) {
      console.warn(`Skipping ZIP code ${code} with invalid boundary:`, error);
      unmappedCodes.push(code);
    }
  }
  const points = features.flatMap(({ geometry }) =>
    getGeometryPoints(geometry),
  );

  if (points.length === 0) {
    return {
      type: "FeatureCollection",
      features,
      bounds: [
        [0, 0],
        [0, 0],
      ],
      unmappedCodes,
    };
  }

  const bounds = points.reduce(
    (current, [longitude, latitude]) => ({
      south: Math.min(current.south, latitude),
      west: Math.min(current.west, longitude),
      north: Math.max(current.north, latitude),
      east: Math.max(current.east, longitude),
    }),
    {
      south: Number.POSITIVE_INFINITY,
      west: Number.POSITIVE_INFINITY,
      north: Number.NEGATIVE_INFINITY,
      east: Number.NEGATIVE_INFINITY,
    },
  );
  return {
    type: "FeatureCollection",
    features,
    bounds: [
      [bounds.south, bounds.west],
      [bounds.north, bounds.east],
    ],
    unmappedCodes,
  };
}

function geometryContainsPoint(
  geometry: ZipCodeGeometry,
  longitude: number,
  latitude: number,
) {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;

  return polygons.some(([outerRing, ...holes]) => {
    if (!outerRing || !ringContainsPoint(outerRing, longitude, latitude)) {
      return false;
    }
    return !holes.some((hole) => ringContainsPoint(hole, longitude, latitude));
  });
}

function ringContainsPoint(
  ring: PolygonCoordinates[number],
  longitude: number,
  latitude: number,
) {
  let inside = false;
  for (let index = 0, previous = ring.length - 1; index < ring.length; previous = index++) {
    const [currentX, currentY] = ring[index];
    const [previousX, previousY] = ring[previous];

    const crossProduct =
      (longitude - currentX) * (previousY - currentY) -
      (latitude - currentY) * (previousX - currentX);
    if (
      Math.abs(crossProduct) < 1e-10 &&
      longitude >= Math.min(currentX, previousX) - 1e-10 &&
      longitude <= Math.max(currentX, previousX) + 1e-10 &&
      latitude >= Math.min(currentY, previousY) - 1e-10 &&
      latitude <= Math.max(currentY, previousY) + 1e-10
    ) {
      return true;
    }

    const intersects =
      currentY > latitude !== previousY > latitude &&
      longitude <
        ((previousX - currentX) * (latitude - currentY)) /
          (previousY - currentY) +
          currentX;
    if (intersects) {
      inside = !inside;
    }
  }
  return inside;
}

function getGeometryPoints(geometry: ZipCodeGeometry) {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates]
      : geometry.coordinates;

  return polygons.flatMap((rings) =>
    rings.flatMap((ring) => ring.map((point) => toPoint(point))),
  );
}

function parseGeometry(value: unknown): ZipCodeGeometry {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("coordinates" in value) ||
    !Array.isArray(value.coordinates)
  ) {
    throw new Error("Stored Census boundary is not valid GeoJSON geometry.");
  }

  if (value.type === "Polygon") {
    return {
      type: "Polygon",
      coordinates: parsePolygonCoordinates(value.coordinates),
    };
  }
  if (value.type === "MultiPolygon") {
    return {
      type: "MultiPolygon",
      coordinates: value.coordinates.map(parsePolygonCoordinates),
    };
  }

  throw new Error("Stored Census boundary has an unsupported geometry type.");
}

function parsePolygonCoordinates(value: unknown): PolygonCoordinates {
  if (!Array.isArray(value)) {
    throw new Error("Stored Census polygon has invalid ring coordinates.");
  }
  return value.map((ring) => {
    if (!Array.isArray(ring)) {
      throw new Error("Stored Census polygon has an invalid ring.");
    }
    return ring.map((point) => {
      if (!Array.isArray(point)) {
        throw new Error("Stored Census polygon has an invalid coordinate.");
      }
      const [longitude, latitude] = toPoint(point);
      return [longitude, latitude];
    });
  });
}

function toPoint(coordinates: readonly unknown[]): [number, number] {
  const longitude = coordinates[0];
  const latitude = coordinates[1];
  if (
    typeof longitude !== "number" ||
    typeof latitude !== "number" ||
    !Number.isFinite(longitude) ||
    !Number.isFinite(latitude)
  ) {
    throw new Error("Census ZIP boundary contains an invalid coordinate.");
  }
  return [longitude, latitude];
}
