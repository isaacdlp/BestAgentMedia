import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { Prisma, type PrismaClient } from "@prisma/client";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { geometryAreaSquareMiles } from "./zip-code-area";

type SeedZipCode = {
  code: string;
  centroidLatitude: number;
  centroidLongitude: number;
  boundaryVintage: number;
  populationVintage: number;
  estimatedPopulation: number | null;
  populationMarginOfError: number | null;
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][][] | number[][][];
  };
};

const seedPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "seed",
  "data",
  "zip-code-data.ndjson.gz",
);
const databaseBatchSize = 100;
const expectedBoundaryCount = 33_791;
const expectedPopulationCount = 33_772;

export async function seedZipCodeBoundaries(prisma: PrismaClient) {
  const [existingRecords] = await prisma.$queryRaw<
    Array<{ boundaryCount: bigint; populationCount: bigint; areaCount: bigint }>
  >`
    SELECT
      COUNT(*) FILTER (
        WHERE "boundaryGeometry" IS NOT NULL AND "boundaryVintage" = 2020
      ) AS "boundaryCount",
      COUNT(*) FILTER (
        WHERE "estimatedPopulation" IS NOT NULL AND "populationVintage" = 2024
      ) AS "populationCount",
      COUNT(*) FILTER (WHERE "areaSquareMiles" IS NOT NULL) AS "areaCount"
    FROM "ZipCode"
  `;

  if (
    Number(existingRecords.boundaryCount) === expectedBoundaryCount &&
    Number(existingRecords.populationCount) === expectedPopulationCount &&
    Number(existingRecords.areaCount) === expectedBoundaryCount
  ) {
    console.info("All offline Census ZIP boundaries and population estimates are already seeded.");
    return;
  }

  const input = createInterface({
    input: createReadStream(seedPath).pipe(createGunzip()),
    crlfDelay: Infinity,
  });
  let batch: SeedZipCode[] = [];
  let importedCount = 0;
  let populationCount = 0;

  for await (const line of input) {
    if (!line.trim()) {
      continue;
    }

    const row = validateSeedZipCode(JSON.parse(line) as unknown);
    if (row.estimatedPopulation !== null) {
      populationCount += 1;
    }
    batch.push(row);
    if (batch.length === databaseBatchSize) {
      await upsertBatch(prisma, batch);
      importedCount += batch.length;
      batch = [];
    }
  }

  if (batch.length > 0) {
    await upsertBatch(prisma, batch);
    importedCount += batch.length;
  }
  if (importedCount === 0) {
    throw new Error(`Offline Census ZIP seed is empty: ${seedPath}`);
  }
  if (
    importedCount !== expectedBoundaryCount ||
    populationCount !== expectedPopulationCount
  ) {
    throw new Error(
      `Offline Census ZIP seed has ${importedCount} boundaries and ${populationCount} population estimates; expected ${expectedBoundaryCount} and ${expectedPopulationCount}.`,
    );
  }

  console.info(`Imported ${importedCount} offline Census ZIP boundary/population records.`);
}

async function upsertBatch(prisma: PrismaClient, batch: SeedZipCode[]) {
  const values = batch.map((row) => {
    const geometry = JSON.stringify(row.geometry);
    return Prisma.sql`(
      ${row.code},
      ${geometry}::jsonb,
      ${row.centroidLatitude},
      ${row.centroidLongitude},
      ${geometryAreaSquareMiles(row.geometry)},
      ${row.boundaryVintage},
      ${row.estimatedPopulation},
      ${row.populationMarginOfError},
      ${row.populationVintage}
    )`;
  });

  await prisma.$executeRaw(Prisma.sql`
    INSERT INTO "ZipCode" (
      "code",
      "boundaryGeometry",
      "centroidLatitude",
      "centroidLongitude",
      "areaSquareMiles",
      "boundaryVintage",
      "estimatedPopulation",
      "populationMarginOfError",
      "populationVintage"
    )
    VALUES ${Prisma.join(values)}
    ON CONFLICT ("code") DO UPDATE SET
      "boundaryGeometry" = EXCLUDED."boundaryGeometry",
      "centroidLatitude" = EXCLUDED."centroidLatitude",
      "centroidLongitude" = EXCLUDED."centroidLongitude",
      "areaSquareMiles" = EXCLUDED."areaSquareMiles",
      "boundaryVintage" = EXCLUDED."boundaryVintage",
      "estimatedPopulation" = EXCLUDED."estimatedPopulation",
      "populationMarginOfError" = EXCLUDED."populationMarginOfError",
      "populationVintage" = EXCLUDED."populationVintage"
  `);
}

function validateSeedZipCode(value: unknown): SeedZipCode {
  if (typeof value !== "object" || value === null) {
    throw new Error("Offline Census ZIP seed contains a non-object record.");
  }

  const row = value as Partial<SeedZipCode>;
  if (
    typeof row.code !== "string" ||
    !/^\d{5}$/.test(row.code) ||
    typeof row.centroidLatitude !== "number" ||
    !Number.isFinite(row.centroidLatitude) ||
    typeof row.centroidLongitude !== "number" ||
    !Number.isFinite(row.centroidLongitude) ||
    row.boundaryVintage !== 2020 ||
    row.populationVintage !== 2024 ||
    !isOptionalInteger(row.estimatedPopulation) ||
    !isOptionalInteger(row.populationMarginOfError) ||
    !isZipGeometry(row.geometry)
  ) {
    throw new Error("Offline Census ZIP seed contains an invalid record.");
  }

  return row as SeedZipCode;
}

function isOptionalInteger(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isSafeInteger(value));
}

function isZipGeometry(
  value: unknown,
): value is SeedZipCode["geometry"] {
  if (
    typeof value !== "object" ||
    value === null ||
    !("type" in value) ||
    !("coordinates" in value)
  ) {
    return false;
  }

  return (
    (value.type === "Polygon" || value.type === "MultiPolygon") &&
    Array.isArray(value.coordinates)
  );
}
