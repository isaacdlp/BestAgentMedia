import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { once } from "node:events";
import { createGzip } from "node:zlib";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";

type CensusFeature = {
  type: "Feature";
  properties: {
    GEOID: string;
    CENTLAT: string;
    CENTLON: string;
  };
  geometry:
    | { type: "Polygon"; coordinates: number[][][] }
    | { type: "MultiPolygon"; coordinates: number[][][][] };
};

type SeedZipCode = {
  code: string;
  centroidLatitude: number;
  centroidLongitude: number;
  boundaryVintage: 2020;
  populationVintage: 2024;
  estimatedPopulation: number | null;
  populationMarginOfError: number | null;
  geometry: CensusFeature["geometry"];
};

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dataDirectory = resolve(projectRoot, "prisma", "seed", "data");
const outputPath = resolve(dataDirectory, "zip-code-data.ndjson.gz");
const temporaryOutputPath = `${outputPath}.tmp`;
const tigerWebQueryUrl =
  "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2/query";
const acsPopulationUrl =
  "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat";
const boundaryVintage = 2020;
const populationVintage = 2024;
const pageSize = 500;
const pageConcurrency = 6;

async function main() {
  await mkdir(dataDirectory, { recursive: true });
  const populations = await downloadPopulationEstimates();
  const totalCount = await getBoundaryCount();
  const output = createWriteStream(temporaryOutputPath);
  const gzip = createGzip({ level: 9 });
  const writing = pipeline(gzip, output);
  const seenCodes = new Set<string>();
  let boundaryCount = 0;
  let populationMatchCount = 0;
  let populationMissingCount = 0;

  try {
    for (
      let offset = 0;
      offset < totalCount;
      offset += pageSize * pageConcurrency
    ) {
      const pageOffsets = Array.from(
        { length: pageConcurrency },
        (_, pageIndex) => offset + pageIndex * pageSize,
      ).filter((pageOffset) => pageOffset < totalCount);
      const pages = await Promise.all(pageOffsets.map(downloadBoundaryPage));

      for (const features of pages) {
        if (features.length === 0) {
          throw new Error(
            `TIGERweb boundary download ended early at record ${boundaryCount} of ${totalCount}.`,
          );
        }

        for (const feature of features) {
          const record = toSeedRecord(feature, populations);
          if (seenCodes.has(record.code)) {
            throw new Error(`TIGERweb returned duplicate ZCTA ${record.code}.`);
          }
          seenCodes.add(record.code);
          if (record.estimatedPopulation !== null) {
            populationMatchCount += 1;
          } else {
            populationMissingCount += 1;
          }
          if (!gzip.write(`${JSON.stringify(record)}\n`)) {
            await once(gzip, "drain");
          }
          boundaryCount += 1;
        }
      }

      if (
        boundaryCount % 2500 < pageSize * pageConcurrency ||
        boundaryCount === totalCount
      ) {
        console.info(`Downloaded ${Math.min(boundaryCount, totalCount)} of ${totalCount} ZCTAs.`);
      }
    }

    if (boundaryCount !== totalCount) {
      throw new Error(
        `TIGERweb returned ${boundaryCount} boundaries; expected ${totalCount}.`,
      );
    }
    if (populationMatchCount === 0) {
      throw new Error("No ZCTA boundaries matched the ACS population estimates.");
    }

    gzip.end();
    await writing;
    await rename(temporaryOutputPath, outputPath);
  } catch (error) {
    gzip.destroy();
    output.destroy();
    await writing.catch(() => undefined);
    await rm(temporaryOutputPath, { force: true });
    throw error;
  }

  console.info(
    `Wrote ${boundaryCount} 2020 Census ZCTA polygons with ${populationMatchCount} population estimates to ${outputPath}.`,
  );
  if (populationMissingCount > 0) {
    console.warn(
      `${populationMissingCount} ZCTAs have no 2024 ACS population estimate and will be stored with a null estimate.`,
    );
  }
  await writeFile(
    resolve(dataDirectory, "source.txt"),
    [
      "ZIP Code Tabulation Area boundaries",
      "Source: U.S. Census Bureau TIGERweb, 2020 Census ZCTA layer.",
      "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_Current/MapServer/2",
      "Geometry simplified by TIGERweb with 0.0005 degree maximum offset for compact map rendering.",
      "",
      "Estimated total population and margin of error",
      "Source: U.S. Census Bureau, 2024 American Community Survey 5-Year Detailed Table B01003.",
      `https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-b01003.dat`,
      "",
      "Records are joined on five-digit ZCTA GEOID values. ZCTAs approximate USPS ZIP codes.",
      "",
    ].join("\n"),
  );
}

async function downloadPopulationEstimates() {
  const response = await fetchWithRetries(acsPopulationUrl);
  const text = await response.text();
  const populations = new Map<
    string,
    { estimate: number | null; marginOfError: number | null }
  >();
  const geoIdPrefix = "860Z200US";

  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith(geoIdPrefix)) {
      continue;
    }

    const [geoId, estimateText, marginText] = line.split("|");
    const code = geoId.slice(geoIdPrefix.length);
    if (!/^\d{5}$/.test(code)) {
      throw new Error(`ACS returned an invalid ZCTA identifier: ${geoId}`);
    }
    if (populations.has(code)) {
      throw new Error(`ACS returned duplicate population estimates for ZCTA ${code}.`);
    }

    populations.set(code, {
      estimate: parseEstimate(estimateText),
      marginOfError: parseEstimate(marginText),
    });
  }

  if (populations.size === 0) {
    throw new Error("No five-digit ZCTA population rows found in the ACS bulk file.");
  }

  console.info(`Loaded ${populations.size} 2024 ACS ZCTA population records.`);
  return populations;
}

async function getBoundaryCount() {
  const params = new URLSearchParams({
    where: "1=1",
    returnCountOnly: "true",
    f: "json",
  });
  const response = await fetchWithRetries(`${tigerWebQueryUrl}?${params.toString()}`);
  const data: unknown = await response.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("count" in data) ||
    typeof data.count !== "number" ||
    !Number.isSafeInteger(data.count) ||
    data.count < 1
  ) {
    throw new Error("TIGERweb returned an invalid ZCTA count.");
  }
  return data.count;
}

async function downloadBoundaryPage(offset: number) {
  const params = new URLSearchParams({
    where: "1=1",
    outFields: "GEOID,CENTLAT,CENTLON",
    returnGeometry: "true",
    outSR: "4326",
    f: "geojson",
    resultRecordCount: String(pageSize),
    resultOffset: String(offset),
    orderByFields: "GEOID ASC",
    geometryPrecision: "4",
    maxAllowableOffset: "0.0005",
  });
  const response = await fetchWithRetries(
    `${tigerWebQueryUrl}?${params.toString()}`,
  );
  const data: unknown = await response.json();
  if (
    typeof data !== "object" ||
    data === null ||
    !("features" in data) ||
    !Array.isArray(data.features) ||
    !data.features.every(isCensusFeature)
  ) {
    throw new Error(`TIGERweb returned malformed ZCTA data at offset ${offset}.`);
  }
  return data.features;
}

async function fetchWithRetries(url: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    try {
      const response = await fetch(url, {
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        throw new Error(`Census request failed with status ${response.status}.`);
      }
      return response;
    } catch (error) {
      lastError = error;
      if (attempt < 4) {
        await new Promise((resolveDelay) =>
          setTimeout(resolveDelay, attempt * 1000),
        );
      }
    }
  }
  throw lastError;
}

function toSeedRecord(
  feature: CensusFeature,
  populations: Map<
    string,
    { estimate: number | null; marginOfError: number | null }
  >,
): SeedZipCode {
  const code = feature.properties.GEOID;
  const centroidLatitude = Number(feature.properties.CENTLAT);
  const centroidLongitude = Number(feature.properties.CENTLON);
  const population = populations.get(code);

  if (!/^\d{5}$/.test(code)) {
    throw new Error(`TIGERweb returned an invalid ZCTA identifier: ${code}`);
  }
  if (!Number.isFinite(centroidLatitude) || !Number.isFinite(centroidLongitude)) {
    throw new Error(`TIGERweb returned an invalid centroid for ZCTA ${code}.`);
  }
  return {
    code,
    centroidLatitude,
    centroidLongitude,
    boundaryVintage,
    populationVintage,
    estimatedPopulation: population?.estimate ?? null,
    populationMarginOfError: population?.marginOfError ?? null,
    geometry: feature.geometry,
  };
}

function parseEstimate(value: string | undefined) {
  if (value === undefined || value === "" || Number(value) < 0) {
    return null;
  }
  const estimate = Number(value);
  if (!Number.isSafeInteger(estimate)) {
    throw new Error(`ACS returned an invalid population estimate: ${value}`);
  }
  return estimate;
}

function isCensusFeature(value: unknown): value is CensusFeature {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    value.type !== "Feature" ||
    !("properties" in value) ||
    typeof value.properties !== "object" ||
    value.properties === null ||
    !("GEOID" in value.properties) ||
    typeof value.properties.GEOID !== "string" ||
    !("CENTLAT" in value.properties) ||
    typeof value.properties.CENTLAT !== "string" ||
    !("CENTLON" in value.properties) ||
    typeof value.properties.CENTLON !== "string" ||
    !("geometry" in value) ||
    typeof value.geometry !== "object" ||
    value.geometry === null ||
    !("type" in value.geometry) ||
    !("coordinates" in value.geometry)
  ) {
    return false;
  }

  if (value.geometry.type === "Polygon") {
    return isPolygonCoordinates(value.geometry.coordinates);
  }
  if (value.geometry.type === "MultiPolygon") {
    return (
      Array.isArray(value.geometry.coordinates) &&
      value.geometry.coordinates.every(isPolygonCoordinates)
    );
  }
  return false;
}

function isPolygonCoordinates(value: unknown): value is number[][][] {
  return (
    Array.isArray(value) &&
    value.every(
      (ring) =>
        Array.isArray(ring) &&
        ring.every(
          (position) =>
            Array.isArray(position) &&
            position.length >= 2 &&
            position.every(
              (coordinate) =>
                typeof coordinate === "number" && Number.isFinite(coordinate),
            ),
        ),
    )
  );
}

main().catch((error: unknown) => {
  console.error("Census seed snapshot refresh failed:", error);
  process.exitCode = 1;
});
