"use client";

import { useState } from "react";
import { formatCents } from "@/lib/promotion-packages";

export type AdStyleOption = {
  id: number;
  publicationId: number;
  publicationName: string;
  name: string;
  description: string;
  priceCents: number;
};

type IssueRef = { publicationId: number };

/** Ad styles available for the selected issues: the ad rates of their publications. */
export function adStylesFor(options: AdStyleOption[], issues: IssueRef[]): AdStyleOption[] {
  const publicationIds = new Set(issues.map((issue) => issue.publicationId));
  return options.filter((option) => publicationIds.has(option.publicationId));
}

/** List price of an ad style: its price per issue times the selected issues of that publication. */
export function adCostCents(style: AdStyleOption, issues: IssueRef[]): number {
  return style.priceCents * issues.filter((issue) => issue.publicationId === style.publicationId).length;
}

/**
 * State for an ad's style and cost. The cost follows the list price of the chosen style until it
 * is edited by hand (for example to give a client a discount).
 */
export function useAdPricing({
  options,
  issues,
  initialStyleId = "",
  initialCostCents = null,
}: {
  options: AdStyleOption[];
  issues: IssueRef[];
  initialStyleId?: string;
  initialCostCents?: number | null;
}) {
  const [styleId, setStyleId] = useState(initialStyleId);
  const [override, setOverride] = useState<string | null>(() => {
    if (initialCostCents === null) return null;
    const style = options.find((option) => String(option.id) === initialStyleId);
    if (style && adCostCents(style, issues) === initialCostCents) return null;
    return String(initialCostCents / 100);
  });

  const selected = adStylesFor(options, issues).find((option) => String(option.id) === styleId) ?? null;
  const listPriceCents = selected ? adCostCents(selected, issues) : null;
  const costValue = override ?? (listPriceCents === null ? "" : String(listPriceCents / 100));
  const costCents = costValue === "" || Number.isNaN(Number(costValue)) ? null : Math.round(Number(costValue) * 100);

  return {
    styleId,
    setStyleId,
    selected,
    listPriceCents,
    costValue,
    costCents,
    setCost: (value: string) => setOverride(value),
    resetCost: () => setOverride(null),
  };
}

/**
 * Style and cost fields for an ad. They appear once an issue is selected: the style lists the ad
 * rates of the issues' publications (submitted as `packageId`), and the cost (submitted as `cost`,
 * in dollars) starts at the list price and can be changed to offer a discount.
 */
export function AdStyleField({
  options,
  issues,
  pricing,
}: {
  options: AdStyleOption[];
  issues: IssueRef[];
  pricing: ReturnType<typeof useAdPricing>;
}) {
  if (!issues.length) return null;

  const available = adStylesFor(options, issues);
  const multiplePublications = new Set(available.map((option) => option.publicationId)).size > 1;
  const { selected, listPriceCents, costCents } = pricing;
  const issueCount = selected ? issues.filter((issue) => issue.publicationId === selected.publicationId).length : 0;

  if (!available.length) {
    return (
      <div className="business-field business-field-wide">
        <span>Style</span>
        <p className="muted">
          The selected issue&rsquo;s publication has no ad rates yet. Add them under Promotion rates on the publication
          page to price this ad.
        </p>
      </div>
    );
  }

  const discountCents = listPriceCents !== null && costCents !== null ? listPriceCents - costCents : 0;

  return (
    <>
      <div className="business-field business-field-wide ad-style-field">
        <label htmlFor="ad-style">
          Style <span aria-hidden="true">*</span>
        </label>
        <select
          id="ad-style"
          name="packageId"
          onChange={(event) => pricing.setStyleId(event.target.value)}
          required
          value={selected ? pricing.styleId : ""}
        >
          <option disabled value="">
            Select a style to calculate the cost…
          </option>
          {available.map((option) => (
            <option key={option.id} value={option.id}>
              {multiplePublications ? `${option.publicationName} — ` : ""}
              {option.name} — {formatCents(option.priceCents)} per issue
            </option>
          ))}
        </select>
        {selected?.description ? <p className="muted ad-style-cost">{selected.description}</p> : null}
      </div>

      {selected && listPriceCents !== null ? (
        <div className="business-field ad-cost-field">
          <label htmlFor="ad-cost">
            Cost (USD) <span aria-hidden="true">*</span>
          </label>
          <input
            id="ad-cost"
            min={0}
            name="cost"
            onChange={(event) => pricing.setCost(event.target.value)}
            required
            step="0.01"
            type="number"
            value={pricing.costValue}
          />
          <p className="ad-style-cost muted" aria-live="polite">
            List price {formatCents(listPriceCents)}
            {issueCount > 1 ? ` (${formatCents(selected.priceCents)} × ${issueCount} issues)` : ""}
            {discountCents > 0 && listPriceCents > 0
              ? ` · discount ${formatCents(discountCents)} (${Math.round((discountCents / listPriceCents) * 100)}%)`
              : discountCents < 0
                ? " · above list price"
                : ""}
            {discountCents !== 0 ? (
              <>
                {" · "}
                <button className="text-link ad-cost-reset" onClick={pricing.resetCost} type="button">
                  Reset to list price
                </button>
              </>
            ) : null}
          </p>
        </div>
      ) : null}
    </>
  );
}
