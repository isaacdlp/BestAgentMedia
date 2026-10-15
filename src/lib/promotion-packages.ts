import type { PromotionPackageKind } from "@prisma/client";

/** A priced placement from a publication's rate card, as offered to an advertiser. */
export type PromotionPackageOffer = {
  id: number;
  kind: PromotionPackageKind;
  name: string;
  description: string;
  priceCents: number;
};

export type PromotionTarget = "ad" | "article";

export function packageKindFor(target: PromotionTarget): PromotionPackageKind {
  return target === "ad" ? "AD" : "ARTICLE";
}

export const DEFAULT_PROMOTION_FOLLOW_UP_DAYS = 3;
export const DEFAULT_PROMOTION_MODEL = "claude-opus-5-5";
/** Largest bundle discount the Marketer may give on a Promote sale, in percent of the order's list total. */
export const DEFAULT_MAX_DISCOUNT_PERCENT = 15;

export type PromotionSettings = {
  followUpDays: number;
  model: string;
  /** Hard cap on Promote sale discounts (Marketer `promotion.maxDiscountPercent`). */
  maxDiscountPercent: number;
  /** Ad-submission form the Marketer may point interested businesses to (Marketer `advertisingUrl`). */
  advertisingUrl: string;
};

/** Reads the `promotion` section (and `advertisingUrl`) of the Marketer agent settings. Prices live on each Publication. */
export function getPromotionSettings(rawSettings: unknown): PromotionSettings {
  const settings = rawSettings && typeof rawSettings === "object" ? (rawSettings as Record<string, unknown>) : {};
  const promotion =
    settings.promotion && typeof settings.promotion === "object" ? (settings.promotion as Record<string, unknown>) : {};
  return {
    followUpDays:
      typeof promotion.followUpDays === "number" && promotion.followUpDays >= 0
        ? promotion.followUpDays
        : DEFAULT_PROMOTION_FOLLOW_UP_DAYS,
    model: typeof promotion.model === "string" && promotion.model.trim() ? promotion.model.trim() : DEFAULT_PROMOTION_MODEL,
    maxDiscountPercent:
      typeof promotion.maxDiscountPercent === "number" && promotion.maxDiscountPercent >= 0
        ? Math.min(Math.floor(promotion.maxDiscountPercent), 50)
        : DEFAULT_MAX_DISCOUNT_PERCENT,
    advertisingUrl: typeof settings.advertisingUrl === "string" ? settings.advertisingUrl.trim() : "",
  };
}

export function formatUsd(amount: number): string {
  return amount.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: amount % 1 ? 2 : 0 });
}

export function formatCents(cents: number): string {
  return formatUsd(cents / 100);
}

/** "$295 – $1,250" for a set of packages, or null when there are none. */
export function formatPriceRange(packages: { priceCents: number }[]): string | null {
  if (!packages.length) return null;
  const prices = packages.map((item) => item.priceCents);
  const low = Math.min(...prices);
  const high = Math.max(...prices);
  return low === high ? formatCents(low) : `${formatCents(low)} – ${formatCents(high)}`;
}
