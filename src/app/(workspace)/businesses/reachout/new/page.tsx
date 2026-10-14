"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AgentBadge } from "@/components/agent-badge";
import { ClientListToolbar } from "@/components/list-toolbar";
import { ClientListPagination } from "@/components/list-pagination";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";

type BusinessRow = {
  id: number;
  name: string;
  email: string | null;
  primaryCategory: string | null;
  postalCode: string | null;
  hasActiveTask: boolean;
};

export default function NewReachoutPage() {
  const router = useRouter();
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function buildUrl() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", sort);
    params.set("order", order);
    params.set("page", String(page));
    params.set("limit", String(limit));
    params.set("withReachoutStatus", "1");
    return `/api/businesses?${params.toString()}`;
  }

  const loadBusinesses = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(buildUrl());
      const data = (await res.json()) as { items: BusinessRow[]; total: number } | { error: string };
      if (!res.ok || !("items" in data)) throw new Error("error" in data ? data.error : "Failed to load.");
      setBusinesses(data.items);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load businesses.");
    } finally {
      setLoading(false);
    }
  }, [q, sort, order, page, limit]);

  useEffect(() => {
    const id = setTimeout(() => { void loadBusinesses(); }, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [q, sort, order, page, limit]);

  function toggleAll() {
    const eligible = businesses.filter((b) => b.email && !b.hasActiveTask).map((b) => b.id);
    const allSelected = eligible.every((id) => selected.has(id));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        eligible.forEach((id) => next.delete(id));
      } else {
        eligible.forEach((id) => next.add(id));
      }
      return next;
    });
  }

  function toggleOne(id: number) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    const ids = Array.from(selected);
    if (!ids.length) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/reachout-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessIds: ids }),
      });
      const data = (await res.json()) as { created?: number; tasks?: LaunchedTask[]; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Failed to create tasks.");
      announceTaskStarted(data.tasks ?? []);
      router.push("/businesses");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create tasks.");
      setSubmitting(false);
    }
  }

  const eligible = businesses.filter((b) => b.email && !b.hasActiveTask);
  const allEligibleSelected = eligible.length > 0 && eligible.every((b) => selected.has(b.id));

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow"><Link href="/businesses/reachout">← Reachout tasks</Link></p>
          <h1>New onboarding task</h1>
          <p className="muted">Select businesses to start the onboarding email sequence for.</p>
          <AgentBadge agentSlug="assistant" />
        </div>
      </div>

      <section className="panel">
        <div className="panel-heading">
          <h2>
            Select businesses
            {selected.size > 0 ? (
              <span className="count-badge" style={{ marginLeft: 8 }}>{selected.size} selected</span>
            ) : null}
          </h2>
          <button
            className="button button-primary"
            disabled={selected.size === 0 || submitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? "Starting…" : `Start onboarding (${selected.size})`}
          </button>
        </div>

        <ClientListToolbar
          q={q} onQChange={(v) => { setQ(v); setPage(1); }}
          sort={sort} onSortChange={(v) => { setSort(v); setPage(1); }}
          order={order} onOrderChange={(v) => { setOrder(v); setPage(1); }}
          limit={limit} onLimitChange={(v) => { setLimit(v); setPage(1); }}
          sortOptions={[
            { label: "Name", value: "name" },
            { label: "City", value: "city" },
            { label: "Category", value: "category" },
          ]}
        />

        {error ? <p className="form-error">{error}</p> : null}

        {loading ? (
          <p className="muted">Loading businesses…</p>
        ) : businesses.length ? (
          <div className="reachout-new-table">
            <div className="reachout-new-table-head">
              <label className="reachout-new-check">
                <input
                  checked={allEligibleSelected}
                  onChange={toggleAll}
                  type="checkbox"
                />
                <span className="muted" style={{ fontSize: 11 }}>All eligible</span>
              </label>
              <span className="muted reachout-new-col-name">Business</span>
              <span className="muted reachout-new-col-email">Email</span>
              <span className="muted reachout-new-col-cat">Category</span>
              <span className="muted reachout-new-col-status">Status</span>
            </div>
            {businesses.map((b) => {
              const canSelect = !!(b.email && !b.hasActiveTask);
              return (
                <label
                  className={`reachout-new-row ${!canSelect ? "reachout-new-row-disabled" : ""}`}
                  key={b.id}
                >
                  <span className="reachout-new-check">
                    <input
                      checked={selected.has(b.id)}
                      disabled={!canSelect}
                      onChange={() => toggleOne(b.id)}
                      type="checkbox"
                    />
                  </span>
                  <span className="reachout-new-col-name">{b.name}</span>
                  <span className="reachout-new-col-email muted">{b.email ?? "—"}</span>
                  <span className="reachout-new-col-cat muted">{b.primaryCategory ?? "—"}</span>
                  <span className="reachout-new-col-status">
                    {b.hasActiveTask ? (
                      <span className="reachout-task-badge reachout-task-badge-auto">Active</span>
                    ) : !b.email ? (
                      <span className="reachout-task-no-email">No email</span>
                    ) : (
                      <span className="reachout-task-badge reachout-task-badge-manual">Eligible</span>
                    )}
                  </span>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">{q ? `No businesses match "${q}".` : "No businesses found."}</div>
        )}
        <ClientListPagination total={total} page={page} limit={limit} onPageChange={setPage} />
      </section>
    </>
  );
}
