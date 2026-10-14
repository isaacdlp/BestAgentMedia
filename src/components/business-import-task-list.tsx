"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ClientListToolbar } from "@/components/list-toolbar";
import { ClientListPagination } from "@/components/list-pagination";

export type BusinessImportTaskSummary = {
  id: string;
  sourceProvider: string;
  zipCode: string;
  categories: string[];
  newBusinessLimit: number;
  status: "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";
  message: string;
  startedAt: string;
  finishedAt: string | null;
  businessCount: number;
};

const TASK_SORT_OPTIONS = [
  { label: "Started", value: "startedAt" },
  { label: "Status", value: "status" },
  { label: "ZIP Code", value: "zipCode" },
];

export function BusinessImportTaskList({
  initialTasks,
  initialTotal = initialTasks.length,
}: {
  initialTasks: BusinessImportTaskSummary[];
  initialTotal?: number;
}) {
  const [tasks, setTasks] = useState(initialTasks);
  const [total, setTotal] = useState(initialTotal);
  const [error, setError] = useState<string | null>(null);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("startedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  function buildUrl() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", sort);
    params.set("order", order);
    params.set("page", String(page));
    params.set("limit", String(limit));
    return `/api/business-import-tasks?${params.toString()}`;
  }

  const refreshTasks = useCallback(async (url?: string) => {
    try {
      const response = await fetch(url ?? buildUrl(), { cache: "no-store" });
      const result = (await response.json()) as
        | { items: BusinessImportTaskSummary[]; total: number }
        | { error: string };
      if (!response.ok || !("items" in result)) {
        throw new Error(
          "error" in result ? result.error : "Unable to refresh import tasks.",
        );
      }
      setTasks(result.items);
      setTotal(result.total);
      setError(null);
    } catch (refreshError) {
      setError(
        refreshError instanceof Error
          ? refreshError.message
          : "Unable to refresh import tasks.",
      );
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, order, page, limit]);

  // Re-fetch when filter/sort/page/limit changes (debounce q)
  useEffect(() => {
    const id = setTimeout(() => { void refreshTasks(); }, q ? 300 : 0);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, order, page, limit]);

  // Auto-refresh while any task is running
  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === "RUNNING");
    if (!hasActive) return;
    const timer = window.setInterval(() => { void refreshTasks(); }, 3000);
    return () => window.clearInterval(timer);
  }, [tasks, refreshTasks]);

  async function updateTask(task: BusinessImportTaskSummary, action: "stop" | "delete") {
    if (
      action === "delete" &&
      !window.confirm(
        `Delete the import task for ZIP code ${task.zipCode}? Imported businesses will remain.`,
      )
    ) {
      return;
    }

    setBusyTaskId(task.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/business-import-tasks/${encodeURIComponent(task.id)}`,
        action === "stop"
          ? {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ action: "stop" }),
            }
          : { method: "DELETE" },
      );
      const result = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(result.error ?? "Unable to update the import task.");
      }
      await refreshTasks();
    } catch (actionError) {
      console.error(`Import task ${action} failed:`, actionError);
      setError(
        actionError instanceof Error
          ? actionError.message
          : "Unable to update the import task.",
      );
    } finally {
      setBusyTaskId(null);
    }
  }

  return (
    <section aria-live="polite" className="panel table-panel business-import-tasks">
      <div className="panel-heading">
        <h2>Import tasks <span className="count-badge">{total}</span></h2>
        <button
          className="button button-secondary button-small"
          onClick={() => void refreshTasks()}
          type="button"
        >
          Refresh
        </button>
      </div>
      <ClientListToolbar
        q={q} onQChange={(v) => { setQ(v); setPage(1); }}
        sort={sort} onSortChange={(v) => { setSort(v); setPage(1); }}
        order={order} onOrderChange={(v) => { setOrder(v); setPage(1); }}
        limit={limit} onLimitChange={(v) => { setLimit(v); setPage(1); }}
        sortOptions={TASK_SORT_OPTIONS}
      />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {tasks.length ? (
        <div className="business-import-task-list">
          {tasks.map((task) => (
            <article className="business-import-task" key={task.id}>
              <div className="business-import-task-header">
                <div>
                  <Link
                    className="business-import-task-title"
                    href={`/businesses/import/${encodeURIComponent(task.id)}`}
                  >
                    <h3>
                      {task.sourceProvider === "HERE" ? "HERE Maps" : task.sourceProvider}
                      {" · ZIP "}
                      {task.zipCode}
                    </h3>
                  </Link>
                  <p className="muted">
                    Started {new Date(task.startedAt).toLocaleString()}
                  </p>
                </div>
                <span
                  className={`business-import-task-status business-import-task-status-${task.status.toLowerCase()}`}
                >
                  {formatTaskStatus(task.status)}
                </span>
              </div>
              <p className="business-import-task-message">{task.message}</p>
              <p className="muted business-import-task-meta">
                Categories: {task.categories.join(", ")} · Maximum new businesses:{" "}
                {task.newBusinessLimit}
                {" · Imported businesses: "}
                {task.businessCount}
                {task.finishedAt
                  ? ` · Finished ${new Date(task.finishedAt).toLocaleString()}`
                  : ""}
              </p>
              <div className="business-import-task-actions">
                {task.status === "RUNNING" ? (
                  <button
                    className="button button-secondary button-small"
                    disabled={busyTaskId === task.id}
                    onClick={() => void updateTask(task, "stop")}
                    type="button"
                  >
                    Stop task
                  </button>
                ) : null}
                <button
                  className="button button-secondary button-small"
                  disabled={busyTaskId === task.id}
                  onClick={() => void updateTask(task, "delete")}
                  type="button"
                >
                  Delete task
                </button>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <div className="empty-state">{q ? `No tasks match "${q}".` : "No import tasks have been started yet."}</div>
      )}
      <ClientListPagination total={total} page={page} limit={limit} onPageChange={setPage} />
    </section>
  );
}

function formatTaskStatus(status: BusinessImportTaskSummary["status"]) {
  switch (status) {
    case "RUNNING":
      return "Running";
    case "SUCCEEDED":
      return "Succeeded";
    case "FAILED":
      return "Failed";
    case "STOPPED":
      return "Stopped";
  }
}
