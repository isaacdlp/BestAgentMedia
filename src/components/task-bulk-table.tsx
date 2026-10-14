"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BulkActionBar,
  BulkCheckbox,
  bulkDelete,
  bulkDeleteMessage,
  useBulkSelection,
} from "@/components/bulk-select";

export type TaskRow = {
  id: number;
  name: string;
  agentName: string | null;
  status: string;
  statusLabel: string;
  startedAt: string;
  duration: string;
  launchedBy: string | null;
};

/** Task table for /tasks. Administrators can select rows (or the whole page) and delete them. */
export function TaskBulkTable({ rows, isAdmin }: { rows: TaskRow[]; isAdmin: boolean }) {
  const router = useRouter();
  const selection = useBulkSelection(rows.map((row) => row.id));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleDelete() {
    const ids = selection.selectedIds;
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} task${ids.length === 1 ? "" : "s"} and their results? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    const { deleted, failed } = await bulkDelete(ids, (id) => `/api/tasks/${id}`);
    setBusy(false);
    setError(bulkDeleteMessage(failed, deleted.length));
    selection.clear();
    router.refresh();
  }

  return (
    <>
      {isAdmin ? (
        <BulkActionBar
          allSelected={selection.allSelected}
          busy={busy}
          count={selection.selectedIds.length}
          onDelete={() => void handleDelete()}
          onToggleAll={selection.toggleAll}
          someSelected={selection.someSelected}
        />
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {isAdmin ? <th className="bulk-cell" /> : null}
              <th>Task</th>
              <th>Agent</th>
              <th>Status</th>
              <th>Started</th>
              <th>Duration</th>
              {isAdmin ? <th>Launched by</th> : null}
            </tr>
          </thead>
          <tbody>
            {rows.map((task) => (
              <tr key={task.id}>
                {isAdmin ? (
                  <td className="bulk-cell">
                    <BulkCheckbox
                      checked={selection.isSelected(task.id)}
                      disabled={busy}
                      label={`Select ${task.name}`}
                      onChange={() => selection.toggle(task.id)}
                    />
                  </td>
                ) : null}
                <td className="table-primary task-name-cell">
                  <Link className="text-link" href={`/tasks/${task.id}`}>{task.name}</Link>
                </td>
                <td>{task.agentName ?? <span className="muted">None</span>}</td>
                <td>
                  <span className={`agent-task-status-chip agent-task-status-${task.status.toLowerCase()}`}>
                    {task.statusLabel}
                  </span>
                </td>
                <td>{new Date(task.startedAt).toLocaleString()}</td>
                <td>{task.duration}</td>
                {isAdmin ? (
                  <td>{task.launchedBy ?? <span className="muted">Automatic</span>}</td>
                ) : null}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
