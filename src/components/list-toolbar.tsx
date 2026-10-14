"use client";

import { useState, useEffect, useTransition } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { PAGE_SIZES } from "@/lib/list-params";

export type SortOption = { label: string; value: string };

/** URL-synced toolbar for server-rendered list pages. Must be inside a <Suspense> boundary. */
export function ListToolbar({
  sortOptions = [],
  defaultSort = "",
  defaultOrder = "asc" as "asc" | "desc",
}: {
  sortOptions?: SortOption[];
  defaultSort?: string;
  defaultOrder?: "asc" | "desc";
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();

  const urlQ = searchParams.get("q") ?? "";
  const sort = searchParams.get("sort") ?? defaultSort;
  const order = (searchParams.get("order") ?? defaultOrder) as "asc" | "desc";
  const limit = searchParams.get("limit") ?? "50";

  const [searchValue, setSearchValue] = useState(urlQ);

  useEffect(() => { setSearchValue(urlQ); }, [urlQ]);

  useEffect(() => {
    if (searchValue === urlQ) return;
    const id = setTimeout(() => {
      const params = new URLSearchParams(searchParams.toString());
      if (searchValue) params.set("q", searchValue); else params.delete("q");
      params.delete("page");
      startTransition(() => router.push(`${pathname}?${params.toString()}`));
    }, 300);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchValue]);

  function navigate(overrides: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());
    for (const [k, v] of Object.entries(overrides)) {
      if (v === undefined) params.delete(k); else params.set(k, v);
    }
    params.delete("page");
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  return (
    <div className="list-toolbar">
      <input
        className="list-toolbar-search"
        onChange={(e) => setSearchValue(e.target.value)}
        placeholder="Search…"
        type="search"
        value={searchValue}
      />
      {sortOptions.length > 0 && (
        <>
          <select
            className="list-toolbar-sort"
            onChange={(e) => navigate({ sort: e.target.value })}
            value={sort}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            className="list-toolbar-order-btn"
            onClick={() => navigate({ order: order === "asc" ? "desc" : "asc" })}
            title={order === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
            type="button"
          >
            {order === "asc" ? "↑" : "↓"}
          </button>
        </>
      )}
      <select
        className="list-toolbar-size"
        onChange={(e) => navigate({ limit: e.target.value })}
        value={limit}
      >
        {PAGE_SIZES.map((s) => (
          <option key={s} value={String(s)}>{s} per page</option>
        ))}
      </select>
    </div>
  );
}

/** Inline toolbar for client-managed lists (API-backed, local state). */
export function ClientListToolbar({
  q, onQChange,
  sort, onSortChange,
  order, onOrderChange,
  limit, onLimitChange,
  sortOptions = [],
}: {
  q: string; onQChange: (v: string) => void;
  sort: string; onSortChange: (v: string) => void;
  order: "asc" | "desc"; onOrderChange: (v: "asc" | "desc") => void;
  limit: number; onLimitChange: (v: number) => void;
  sortOptions?: SortOption[];
}) {
  return (
    <div className="list-toolbar">
      <input
        className="list-toolbar-search"
        onChange={(e) => onQChange(e.target.value)}
        placeholder="Search…"
        type="search"
        value={q}
      />
      {sortOptions.length > 0 && (
        <>
          <select
            className="list-toolbar-sort"
            onChange={(e) => onSortChange(e.target.value)}
            value={sort}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
          <button
            className="list-toolbar-order-btn"
            onClick={() => onOrderChange(order === "asc" ? "desc" : "asc")}
            title={order === "asc" ? "Ascending — click for descending" : "Descending — click for ascending"}
            type="button"
          >
            {order === "asc" ? "↑" : "↓"}
          </button>
        </>
      )}
      <select
        className="list-toolbar-size"
        onChange={(e) => onLimitChange(Number(e.target.value))}
        value={String(limit)}
      >
        {PAGE_SIZES.map((s) => (
          <option key={s} value={String(s)}>{s} per page</option>
        ))}
      </select>
    </div>
  );
}
