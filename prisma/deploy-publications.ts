import { PrismaClient } from "@prisma/client";
import { seedPublications } from "./publication-seed";
import { seedZipCodeBoundaries } from "./zip-code-boundary-seed";

const prisma = new PrismaClient();

async function deploySeedData() {
  await seedZipCodeBoundaries(prisma);
  await seedPublications(prisma);
}

deploySeedData()
  .catch((error: unknown) => {
    console.error("Publication media deployment failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
