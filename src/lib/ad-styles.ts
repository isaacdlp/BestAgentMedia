import "server-only";
import type { AdStyleOption } from "@/components/ad-style-field";
import { prisma } from "@/lib/db";

/** Ad rates (styles) of the given publications, for the ad create and edit forms. */
export async function listAdStyleOptions(
  publicationIds: number[],
  kind: "AD" | "ARTICLE" = "AD",
): Promise<AdStyleOption[]> {
  const ids = [...new Set(publicationIds)];
  if (!ids.length) return [];
  const rates = await prisma.promotionPackage.findMany({
    where: { publicationId: { in: ids }, kind },
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

/**
 * Prices an article's paid promotion: the chosen style must be an article rate of one of the
 * issues' publications. The cost defaults to the rate's price per issue times the article's issues
 * in that publication; an entered cost replaces it. No style leaves the article unpriced.
 */
export async function resolveArticleStyle(
  packageId: number | null,
  issueIds: string[],
  enteredCostCents: number | null,
): Promise<{ promotionPackageId: number | null; styleName: string | null; costCents: number | null }> {
  const unpriced = { promotionPackageId: null, styleName: null, costCents: null };
  if (packageId === null || !issueIds.length) return unpriced;
  const issues = await prisma.issue.findMany({ where: { id: { in: issueIds } }, select: { publicationId: true } });
  const rate = await prisma.promotionPackage.findFirst({
    where: { id: packageId, kind: "ARTICLE", publicationId: { in: issues.map((issue) => issue.publicationId) } },
    select: { id: true, name: true, priceCents: true, publicationId: true },
  });
  if (!rate) throw new Error("The selected promotion style is not an article rate of the selected issues' publications.");
  const issueCount = issues.filter((issue) => issue.publicationId === rate.publicationId).length;
  return { promotionPackageId: rate.id, styleName: rate.name, costCents: enteredCostCents ?? rate.priceCents * issueCount };
}

/** Cost entered in dollars as whole cents (null when blank or invalid). */
export function parseDollarsToCents(value: FormDataEntryValue | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > 1_000_000) return null;
  return Math.round(amount * 100);
}

/** Positive integer record ID from a form value (null when blank or invalid). */
export function parsePackageId(value: FormDataEntryValue | null): number | null {
  return typeof value === "string" && /^[1-9]\d{0,9}$/.test(value) ? Number(value) : null;
}
