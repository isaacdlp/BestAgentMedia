const EARTH_RADIUS_MILES = 3958.7613;

type Ring = number[][];
type ZipGeometry = {
  type: "Polygon" | "MultiPolygon";
  coordinates: number[][][] | number[][][][];
};

// Approximate spherical area of a GeoJSON ring (lon/lat degrees), in square miles.
function ringAreaSquareMiles(ring: Ring) {
  let sum = 0;
  for (let i = 0; i < ring.length - 1; i += 1) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    sum +=
      ((lon2 - lon1) * Math.PI) / 180 *
      (2 + Math.sin((lat1 * Math.PI) / 180) + Math.sin((lat2 * Math.PI) / 180));
  }
  return Math.abs((sum * EARTH_RADIUS_MILES ** 2) / 2);
}

function polygonAreaSquareMiles(rings: Ring[]) {
  const [outer, ...holes] = rings;
  if (!outer) return 0;
  return holes.reduce((area, hole) => area - ringAreaSquareMiles(hole), ringAreaSquareMiles(outer));
}

export function geometryAreaSquareMiles(geometry: ZipGeometry) {
  const polygons =
    geometry.type === "Polygon"
      ? [geometry.coordinates as Ring[]]
      : (geometry.coordinates as Ring[][]);
  const area = polygons.reduce((total, rings) => total + polygonAreaSquareMiles(rings), 0);
  return Math.round(area * 100) / 100;
}
