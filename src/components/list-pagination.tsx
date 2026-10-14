"use client";

import { useTransition } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import { pageCount } from "@/lib/list-params";

/** URL-synced pagination for server-rendered list pages. Must be inside a <Suspense> boundary. */
export function ListPagination({
  total,
  page,
  limit,
}: {
  total: number;
  page: number;
  limit: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [, startTransition] = useTransition();
  const pages = pageCount(total, limit);

  if (pages <= 1 && total <= limit) return null;

  function goTo(p: number) {
    const params = new URLSearchParams(searchParams.toString());
    params.set("page", String(p));
    startTransition(() => router.push(`${pathname}?${params.toString()}`));
  }

  const pageNums = buildPageNums(page, pages);

  return (
    <div className="list-pagination">
      <button className="list-pagination-btn" disabled={page <= 1} onClick={() => goTo(page - 1)} type="button">
        ← Prev
      </button>
      <div className="list-pagination-pages">
        {pageNums.map((n, i) =>
          n === "…" ? (
            <span className="list-pagination-ellipsis" key={`e${i}`}>…</span>
          ) : (
            <button
              className={`list-pagination-btn${n === page ? " list-pagination-btn-active" : ""}`}
              key={n}
              onClick={() => goTo(n as number)}
              type="button"
            >
              {n}
            </button>
          ),
        )}
      </div>
      <button className="list-pagination-btn" disabled={page >= pages} onClick={() => goTo(page + 1)} type="button">
        Next →
      </button>
      <span className="list-pagination-info muted">
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
      </span>
    </div>
  );
}

/** Inline pagination for client-managed lists. */
export function ClientListPagination({
  total,
  page,
  limit,
  onPageChange,
}: {
  total: number;
  page: number;
  limit: number;
  onPageChange: (p: number) => void;
}) {
  const pages = pageCount(total, limit);
  if (pages <= 1 && total <= limit) return null;

  const pageNums = buildPageNums(page, pages);

  return (
    <div className="list-pagination">
      <button className="list-pagination-btn" disabled={page <= 1} onClick={() => onPageChange(page - 1)} type="button">
        ← Prev
      </button>
      <div className="list-pagination-pages">
        {pageNums.map((n, i) =>
          n === "…" ? (
            <span className="list-pagination-ellipsis" key={`e${i}`}>…</span>
          ) : (
            <button
              className={`list-pagination-btn${n === page ? " list-pagination-btn-active" : ""}`}
              key={n}
              onClick={() => onPageChange(n as number)}
              type="button"
            >
              {n}
            </button>
          ),
        )}
      </div>
      <button className="list-pagination-btn" disabled={page >= pages} onClick={() => onPageChange(page + 1)} type="button">
        Next →
      </button>
      <span className="list-pagination-info muted">
        {(page - 1) * limit + 1}–{Math.min(page * limit, total)} of {total}
      </span>
    </div>
  );
}

function buildPageNums(page: number, pages: number): (number | "…")[] {
  const nums: (number | "…")[] = [];
  for (let i = 1; i <= pages; i++) {
    if (i === 1 || i === pages || (i >= page - 2 && i <= page + 2)) {
      nums.push(i);
    } else if (nums[nums.length - 1] !== "…") {
      nums.push("…");
    }
  }
  return nums;
}
