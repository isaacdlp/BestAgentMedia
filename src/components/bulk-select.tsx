"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type BulkId = string | number;

/** Tracks which rows of the visible page are selected. Selection is pruned when rows leave the page. */
export function useBulkSelection<K extends BulkId>(visibleIds: K[]) {
  const [selected, setSelected] = useState<Set<K>>(new Set());
  const visibleKey = visibleIds.join("|");

  useEffect(() => {
    const visible = new Set(visibleIds);
    setSelected((previous) => {
      const next = new Set([...previous].filter((id) => visible.has(id)));
      return next.size === previous.size ? previous : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleKey]);

  const toggle = useCallback((id: K) => {
    setSelected((previous) => {
      const next = new Set(previous);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selected.has(id));
  const toggleAll = useCallback(() => {
    setSelected(allSelected ? new Set() : new Set(visibleIds));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allSelected, visibleKey]);
  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(
    () => ({
      selectedIds: visibleIds.filter((id) => selected.has(id)),
      isSelected: (id: K) => selected.has(id),
      toggle,
      toggleAll,
      clear,
      allSelected,
      someSelected: selected.size > 0 && !allSelected,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selected, toggle, toggleAll, clear, allSelected, visibleKey],
  );
}

/** Select-all checkbox and "Delete selected" action for a list. */
export function BulkActionBar({
  count,
  allSelected,
  someSelected,
  onToggleAll,
  onDelete,
  statusOptions,
  onApplyStatus,
  busy = false,
}: {
  count: number;
  allSelected: boolean;
  someSelected: boolean;
  onToggleAll: () => void;
  onDelete?: () => void;
  statusOptions?: Array<{ label: string; value: string }>;
  onApplyStatus?: (status: string) => void;
  busy?: boolean;
}) {
  const [status, setStatus] = useState("");
  const checkboxRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (checkboxRef.current) checkboxRef.current.indeterminate = someSelected;
  }, [someSelected]);

  return (
    <div className="bulk-action-bar">
      <label className="bulk-action-select-all">
        <input
          checked={allSelected}
          disabled={busy}
          onChange={onToggleAll}
          ref={checkboxRef}
          type="checkbox"
        />
        <span>{count ? `${count} selected` : "Select all on this page"}</span>
      </label>
      {count && statusOptions && onApplyStatus ? (
        <span className="bulk-action-status">
          <select
            className="bulk-action-status-select"
            aria-label="Status to apply to selected"
            disabled={busy}
            onChange={(event) => setStatus(event.target.value)}
            value={status}
          >
            <option value="">Status</option>
            {statusOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <button
            className="button button-secondary button-small"
            disabled={busy || !status}
            onClick={() => onApplyStatus(status)}
            type="button"
          >
            Apply
          </button>
        </span>
      ) : null}
      {count && onDelete ? (
        <button
          className="button button-secondary button-small bulk-action-delete"
          disabled={busy}
          onClick={onDelete}
          type="button"
        >
          {busy ? "Deleting…" : `Delete selected (${count})`}
        </button>
      ) : null}
    </div>
  );
}

/** Row/card checkbox bound to a selection. */
export function BulkCheckbox({
  checked,
  onChange,
  label,
  disabled = false,
}: {
  checked: boolean;
  onChange: () => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <input
      aria-label={label}
      checked={checked}
      className="bulk-checkbox"
      disabled={disabled}
      onChange={onChange}
      type="checkbox"
    />
  );
}

/**
 * Deletes each id with its own DELETE request (so every item keeps its existing authorization
 * and cleanup rules) and reports which succeeded and why the rest failed.
 */
export async function bulkDelete<K extends BulkId>(
  ids: K[],
  urlFor: (id: K) => string,
): Promise<{ deleted: K[]; failed: { id: K; error: string }[] }> {
  const deleted: K[] = [];
  const failed: { id: K; error: string }[] = [];
  for (const id of ids) {
    try {
      const response = await fetch(urlFor(id), { method: "DELETE" });
      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Delete failed.");
      }
      deleted.push(id);
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : "Delete failed." });
    }
  }
  return { deleted, failed };
}

export function bulkDeleteMessage(failed: { error: string }[], deletedCount: number): string | null {
  if (!failed.length) return null;
  return `${failed.length} could not be deleted${deletedCount ? ` (${deletedCount} deleted)` : ""}: ${failed[0].error}`;
}
