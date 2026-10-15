"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientListToolbar } from "@/components/list-toolbar";
import { ClientListPagination } from "@/components/list-pagination";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";

export type PromoteIssueOption = { id: string; label: string; zipCount: number; hasRates: boolean };

type SaleStatus = "eligible" | "active" | "purchased" | "opted_out";

type BusinessRow = {
  id: number;
  name: string;
  email: string | null;
  primaryCategory: string | null;
  postalCode: string | null;
  saleStatus: SaleStatus;
};

const STATUS_BADGES: Record<Exclude<SaleStatus, "eligible">, { label: string; className: string; title: string }> = {
  active: { label: "In talks", className: "reachout-task-badge-auto", title: "A sales conversation for this issue is already open." },
  purchased: { label: "Purchased", className: "promote-badge-purchased", title: "Already bought promotions in this issue." },
  opted_out: { label: "Opted out", className: "promote-badge-opted-out", title: "Asked not to be contacted." },
};

const INSTRUCTION_SUGGESTIONS = [
  "Lead with the sponsored article",
  "You may offer 10% off a single ad to first-time advertisers",
  "Push the multi-issue bundle",
];

/** Issue picker, Marketer instructions and the business selection for a Promote campaign. */
export function PromoteForm({
  issues,
  maxDiscountPercent,
  maxInstructions,
  preselectedBusinessId,
}: {
  issues: PromoteIssueOption[];
  maxDiscountPercent: number;
  maxInstructions: number;
  preselectedBusinessId: number | null;
}) {
  const router = useRouter();
  const [issueId, setIssueId] = useState(issues.length === 1 ? issues[0].id : "");
  const [instructions, setInstructions] = useState("");
  const [businesses, setBusinesses] = useState<BusinessRow[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set(preselectedBusinessId ? [preselectedBusinessId] : []),
  );
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("name");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const issue = issues.find((item) => item.id === issueId) ?? null;

  const loadBusinesses = useCallback(async () => {
    if (!issueId) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ issueId, sort, order, page: String(page), limit: String(limit) });
      if (q) params.set("q", q);
      const res = await fetch(`/api/businesses?${params.toString()}`);
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
  }, [issueId, q, sort, order, page, limit]);

  useEffect(() => {
    const id = setTimeout(() => { void loadBusinesses(); }, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [loadBusinesses, q]);

  function changeIssue(value: string) {
    setIssueId(value);
    setPage(1);
    // The selection belongs to the previous publication's ZIP codes.
    setSelected(new Set(preselectedBusinessId ? [preselectedBusinessId] : []));
    setBusinesses([]);
    setTotal(0);
  }

  const canSelect = (b: BusinessRow) => Boolean(b.email) && b.saleStatus === "eligible";
  const eligible = businesses.filter(canSelect);
  const allEligibleSelected = eligible.length > 0 && eligible.every((b) => selected.has(b.id));

  function toggleAll() {
    setSelected((prev) => {
      const next = new Set(prev);
      if (allEligibleSelected) eligible.forEach((b) => next.delete(b.id));
      else eligible.forEach((b) => next.add(b.id));
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
    if (!issueId || !ids.length) return;
    setSubmitting(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch("/api/promotion-sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ issueId, businessIds: ids, instructions }),
      });
      const text = await res.text();
      let data: { tasks?: LaunchedTask[]; skipped?: { name: string; reason: string }[]; error?: string } = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch {
        // keep the empty result
      }
      if (!res.ok) throw new Error(data.error ?? `The promotion could not be started (server responded ${res.status}).`);
      announceTaskStarted(data.tasks ?? []);
      if (data.skipped?.length) {
        // Stay on the page so the skipped businesses and their reasons can be read.
        setNotice(`Skipped: ${data.skipped.map((item) => `${item.name} (${item.reason})`).join("; ")}.`);
        setSelected(new Set());
        setSubmitting(false);
        void loadBusinesses();
        return;
      }
      router.push("/businesses");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The promotion could not be started.");
      setSubmitting(false);
    }
  }

  return (
    <>
      <section className="panel promote-setup">
        <div className="panel-heading">
          <h2>1. Issue to promote</h2>
        </div>
        {issues.length ? (
          <label className="enhance-label">
            <span>Issue</span>
            <select className="promote-select" onChange={(e) => changeIssue(e.target.value)} value={issueId}>
              <option value="">Choose an upcoming issue…</option>
              {issues.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}{item.hasRates ? "" : " — no promotion rates"}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="muted">
            {preselectedBusinessId
              ? "No upcoming, unpublished issue belongs to a publication that serves this business's ZIP code."
              : "There are no upcoming, unpublished issues. Create an issue first."}
          </p>
        )}
        {issue && !issue.hasRates ? (
          <p className="form-error">
            This publication has no promotion rates, so there is nothing to sell. Add them under Promotion rates on the publication page.
          </p>
        ) : null}
        {issue ? (
          <p className="muted promote-hint">
            Businesses are limited to the {issue.zipCount} ZIP code{issue.zipCount === 1 ? "" : "s"} served by this publication. The
            Marketer quotes the publication&rsquo;s rate card, can sell placements in its other upcoming issues too, keeps
            individual prices firm, and may give up to {maxDiscountPercent}% off bundles.
          </p>
        ) : null}

        <label className="enhance-label promote-instructions">
          <span>
            Custom instructions for the Marketer <span className="muted">(optional)</span>
          </span>
          <textarea
            className="enhance-textarea"
            maxLength={maxInstructions}
            onChange={(e) => setInstructions(e.target.value)}
            placeholder="Anything the Marketer should know or do in these conversations. Individual prices are only discounted if you say so here."
            rows={3}
            value={instructions}
          />
          <span className="muted enhance-counter">{instructions.length}/{maxInstructions}</span>
        </label>
        <div className="enhance-chips" aria-label="Quick suggestions">
          {INSTRUCTION_SUGGESTIONS.map((text) => (
            <button
              className="enhance-chip"
              disabled={instructions.length + text.length + 2 > maxInstructions}
              key={text}
              onClick={() => setInstructions((prev) => (prev.trim() ? `${prev.trim()}. ${text}` : text))}
              type="button"
            >
              {text}
            </button>
          ))}
        </div>
      </section>

      <section className="panel">
        <div className="panel-heading">
          <h2>
            2. Select businesses
            {selected.size > 0 ? <span className="count-badge" style={{ marginLeft: 8 }}>{selected.size} selected</span> : null}
          </h2>
          <button
            className="button button-primary"
            disabled={!issue?.hasRates || selected.size === 0 || submitting}
            onClick={() => void handleSubmit()}
            type="button"
          >
            {submitting ? "Starting…" : `Start promotion (${selected.size})`}
          </button>
        </div>

        {issueId ? (
          <>
            <ClientListToolbar
              q={q} onQChange={(v) => { setQ(v); setPage(1); }}
              sort={sort} onSortChange={(v) => { setSort(v); setPage(1); }}
              order={order} onOrderChange={(v) => { setOrder(v); setPage(1); }}
              limit={limit} onLimitChange={(v) => { setLimit(v); setPage(1); }}
              sortOptions={[
                { label: "Name", value: "name" },
                { label: "Category", value: "category" },
                { label: "ZIP code", value: "zip" },
              ]}
            />

            {error ? <p className="form-error">{error}</p> : null}
            {notice ? <p className="muted promote-notice" role="status">{notice}</p> : null}

            {loading ? (
              <p className="muted">Loading businesses…</p>
            ) : businesses.length ? (
              <div className="reachout-new-table promote-table">
                <div className="reachout-new-table-head">
                  <label className="reachout-new-check">
                    <input
                      aria-label="Select all eligible businesses"
                      checked={allEligibleSelected}
                      onChange={toggleAll}
                      type="checkbox"
                    />
                  </label>
                  <span className="muted reachout-new-col-name">Business</span>
                  <span className="muted reachout-new-col-email">Email</span>
                  <span className="muted reachout-new-col-cat">Category</span>
                  <span className="muted reachout-new-col-cat">ZIP</span>
                  <span className="muted reachout-new-col-status">Status</span>
                </div>
                {businesses.map((b) => {
                  const selectable = canSelect(b);
                  const badge = b.saleStatus === "eligible" ? null : STATUS_BADGES[b.saleStatus];
                  return (
                    <label className={`reachout-new-row ${selectable ? "" : "reachout-new-row-disabled"}`} key={b.id}>
                      <span className="reachout-new-check">
                        <input
                          checked={selected.has(b.id)}
                          disabled={!selectable}
                          onChange={() => toggleOne(b.id)}
                          type="checkbox"
                        />
                      </span>
                      <span className="reachout-new-col-name">{b.name}</span>
                      <span className="reachout-new-col-email muted">{b.email ?? "—"}</span>
                      <span className="reachout-new-col-cat muted">{b.primaryCategory ?? "—"}</span>
                      <span className="reachout-new-col-cat muted">{b.postalCode ?? "—"}</span>
                      <span className="reachout-new-col-status">
                        {badge ? (
                          <span className={`reachout-task-badge ${badge.className}`} title={badge.title}>{badge.label}</span>
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
              <div className="empty-state">
                {q ? `No businesses in this publication's ZIP codes match "${q}".` : "No businesses in this publication's ZIP codes yet."}
              </div>
            )}
            <ClientListPagination total={total} page={page} limit={limit} onPageChange={setPage} />
          </>
        ) : (
          <div className="empty-state">Choose an issue to see the businesses its publication serves.</div>
        )}
      </section>
    </>
  );
}
