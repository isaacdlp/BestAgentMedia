export const PAGE_SIZES = [25, 50, 100, 200] as const;
export type PageSize = (typeof PAGE_SIZES)[number];
export const DEFAULT_LIMIT: PageSize = 50;

export type ListParams = {
  page: number;
  limit: PageSize;
  skip: number;
  q: string;
  sort: string;
  order: "asc" | "desc";
};

export function parseListParams(
  sp: Record<string, string | string[] | undefined>,
  defaultSort = "",
  defaultOrder: "asc" | "desc" = "asc",
): ListParams {
  const page = Math.max(1, parseInt(String(sp.page ?? "1"), 10) || 1);
  const limitRaw = parseInt(String(sp.limit ?? "50"), 10);
  const limit: PageSize = (PAGE_SIZES as readonly number[]).includes(limitRaw)
    ? (limitRaw as PageSize)
    : DEFAULT_LIMIT;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const sort = typeof sp.sort === "string" && sp.sort ? sp.sort : defaultSort;
  const order: "asc" | "desc" =
    sp.order === "asc" ? "asc" : sp.order === "desc" ? "desc" : defaultOrder;
  return { page, limit, skip: (page - 1) * limit, q, sort, order };
}

export function pageCount(total: number, limit: number): number {
  return Math.max(1, Math.ceil(total / limit));
}
