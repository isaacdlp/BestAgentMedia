"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClientListToolbar } from "@/components/list-toolbar";
import { ClientListPagination } from "@/components/list-pagination";
import { useBulkSelection, BulkActionBar, BulkCheckbox, bulkDelete, bulkDeleteMessage } from "@/components/bulk-select";

export type ReachoutTaskSummary = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";
  message: string;
  autoTriggered: boolean;
  initialEmailSentAt: string | null;
  reminder1SentAt: string | null;
  reminder2SentAt: string | null;
  createdAt: string;
  finishedAt: string | null;
  business: { id: number; name: string; email: string | null; postalCode: string | null };
  subAgent: { id: number; name: string } | null;
  thread: { _count: { messages: number } } | null;
};

const SORT_OPTIONS = [
  { label: "Created", value: "createdAt" },
  { label: "Status", value: "status" },
  { label: "Business", value: "businessName" },
];

const STATUS_LABELS: Record<ReachoutTaskSummary["status"], string> = {
  PENDING: "Pending",
  RUNNING: "Running",
  SUCCEEDED: "Succeeded",
  FAILED: "Failed",
  STOPPED: "Stopped",
};

function RemindersInfo({ task }: { task: ReachoutTaskSummary }) {
  const parts: string[] = [];
  if (task.initialEmailSentAt) parts.push(`Initial: ${new Date(task.initialEmailSentAt).toLocaleDateString()}`);
  if (task.reminder1SentAt) parts.push(`R1: ${new Date(task.reminder1SentAt).toLocaleDateString()}`);
  if (task.reminder2SentAt) parts.push(`R2: ${new Date(task.reminder2SentAt).toLocaleDateString()}`);
  if (!parts.length) return null;
  return <span className="reachout-task-reminders muted">{parts.join(" · ")}</span>;
}

export function ReachoutTaskList({
  initialTasks,
  initialTotal = initialTasks.length,
}: {
  initialTasks: ReachoutTaskSummary[];
  initialTotal?: number;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [total, setTotal] = useState(initialTotal);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const [statusFilter, setStatusFilter] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const selection = useBulkSelection(tasks.map((t) => t.id));

  function buildUrl() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (statusFilter) params.set("status", statusFilter);
    params.set("sort", sort);
    params.set("order", order);
    params.set("page", String(page));
    params.set("limit", String(limit));
    return `/api/reachout-tasks?${params.toString()}`;
  }

  const refresh = useCallback(async (url?: string) => {
    try {
      const res = await fetch(url ?? buildUrl(), { cache: "no-store" });
      const data = (await res.json()) as { items: ReachoutTaskSummary[]; total: number } | { error: string };
      if (!res.ok || !("items" in data)) throw new Error("error" in data ? data.error : "Refresh failed.");
      setTasks(data.items);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    }
  }, [q, statusFilter, sort, order, page, limit]);

  useEffect(() => {
    const id = setTimeout(() => { void refresh(); }, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [q, statusFilter, sort, order, page, limit]);

  // Auto-refresh while any task is active
  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === "PENDING" || t.status === "RUNNING");
    if (!hasActive) return;
    const timer = window.setInterval(() => { void refresh(); }, 5000);
    return () => window.clearInterval(timer);
  }, [tasks, refresh]);

  async function handleStop(task: ReachoutTaskSummary) {
    setBusyId(task.id);
    try {
      const res = await fetch(`/api/reachout-tasks/${task.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "stop" }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Stop failed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Stop failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleDelete(task: ReachoutTaskSummary) {
    if (!window.confirm(`Delete onboarding task for "${task.business.name}"?`)) return;
    setBusyId(task.id);
    try {
      const res = await fetch(`/api/reachout-tasks/${task.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed.");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setBusyId(null);
    }
  }

  async function handleBulkDelete() {
    const ids = selection.selectedIds;
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} onboarding task${ids.length === 1 ? "" : "s"}?`)) return;
    setBulkBusy(true);
    setError(null);
    const { deleted, failed } = await bulkDelete(ids, (id) => `/api/reachout-tasks/${id}`);
    selection.clear();
    await refresh();
    const message = bulkDeleteMessage(failed, deleted.length);
    if (message) setError(message);
    setBulkBusy(false);
  }

  return (
    <section aria-live="polite" className="panel reachout-tasks-panel">
      <div className="panel-heading">
        <h2>Reachout tasks <span className="count-badge">{total}</span></h2>
        <button className="button button-secondary button-small" onClick={() => void refresh()} type="button">
          Refresh
        </button>
      </div>

      <div className="reachout-filter-row">
        <ClientListToolbar
          q={q} onQChange={(v) => { setQ(v); setPage(1); }}
          sort={sort} onSortChange={(v) => { setSort(v); setPage(1); }}
          order={order} onOrderChange={(v) => { setOrder(v); setPage(1); }}
          limit={limit} onLimitChange={(v) => { setLimit(v); setPage(1); }}
          sortOptions={SORT_OPTIONS}
        />
        <select
          className="reachout-status-filter"
          onChange={(e) => { setStatusFilter(e.target.value); setPage(1); }}
          value={statusFilter}
        >
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="RUNNING">Running</option>
          <option value="SUCCEEDED">Succeeded</option>
          <option value="FAILED">Failed</option>
          <option value="STOPPED">Stopped</option>
        </select>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {tasks.length ? (
        <BulkActionBar
          allSelected={selection.allSelected}
          busy={bulkBusy}
          count={selection.selectedIds.length}
          onDelete={() => void handleBulkDelete()}
          onToggleAll={selection.toggleAll}
          someSelected={selection.someSelected}
        />
      ) : null}
      {tasks.length ? (
        <div className="reachout-task-list">
          {tasks.map((task) => (
            <article className="reachout-task" key={task.id}>
              <div className="reachout-task-header">
                <div className="reachout-task-title">
                  <BulkCheckbox
                    checked={selection.isSelected(task.id)}
                    disabled={bulkBusy}
                    label={`Select onboarding task for ${task.business.name}`}
                    onChange={() => selection.toggle(task.id)}
                  />
                  <Link className="reachout-task-business-link" href={`/businesses/${task.business.id}`}>
                    {task.business.name}
                  </Link>
                  {task.autoTriggered ? (
                    <span className="reachout-task-badge reachout-task-badge-auto">Auto</span>
                  ) : (
                    <span className="reachout-task-badge reachout-task-badge-manual">Manual</span>
                  )}
                </div>
                <span className={`reachout-task-status reachout-task-status-${task.status.toLowerCase()}`}>
                  {STATUS_LABELS[task.status]}
                </span>
              </div>

              <div className="reachout-task-meta">
                {task.business.email ? (
                  <span className="muted">{task.business.email}</span>
                ) : (
                  <span className="reachout-task-no-email">No email on record</span>
                )}
                {task.subAgent ? (
                  <span className="muted"> · via {task.subAgent.name}</span>
                ) : null}
                {task.thread ? (
                  <span className="muted"> · {task.thread._count.messages} message{task.thread._count.messages !== 1 ? "s" : ""}</span>
                ) : null}
              </div>

              {task.message ? (
                <p className="reachout-task-message">{task.message}</p>
              ) : null}

              <div className="reachout-task-footer">
                <div className="reachout-task-times">
                  <span className="muted">Started {new Date(task.createdAt).toLocaleString()}</span>
                  <RemindersInfo task={task} />
                </div>
                <div className="reachout-task-actions">
                  {(task.status === "PENDING" || task.status === "RUNNING") ? (
                    <button
                      className="button button-secondary button-small"
                      disabled={busyId === task.id}
                      onClick={() => void handleStop(task)}
                      type="button"
                    >
                      Stop
                    </button>
                  ) : null}
                  <button
                    className="button button-secondary button-small"
                    disabled={busyId === task.id}
                    onClick={() => void handleDelete(task)}
                    type="button"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">
          {q || statusFilter
            ? "No tasks match the current filter."
            : "No reachout tasks yet. Create one to start onboarding local businesses."}
        </div>
      )}
      <ClientListPagination total={total} page={page} limit={limit} onPageChange={setPage} />
    </section>
  );
}
