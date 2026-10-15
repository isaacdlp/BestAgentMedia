import "server-only";
import type { AdStyleOption } from "@/components/ad-style-field";
import { prisma } from "@/lib/db";

/** Ad rates (styles) of the given publications, for the ad create and edit forms. */
export async function listAdStyleOptions(publicationIds: number[]): Promise<AdStyleOption[]> {
  const ids = [...new Set(publicationIds)];
  if (!ids.length) return [];
  const rates = await prisma.promotionPackage.findMany({
    where: { publicationId: { in: ids }, kind: "AD" },
    orderBy: [{ publicationId: "asc" }, { position: "asc" }, { priceCents: "asc" }],
    select: {
      id: true,
      publicationId: true,
      name: true,
      description: true,
      priceCents: true,
      publication: { select: { name: true } },
    },
  });
  return rates.map(({ publication, ...rate }) => ({ ...rate, publicationName: publication.name }));
}
