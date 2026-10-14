"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import {
  BulkActionBar,
  BulkCheckbox,
  bulkDelete,
  bulkDeleteMessage,
  useBulkSelection,
} from "@/components/bulk-select";

type Id = string | number;

type RecordDeleteContextValue = {
  bulk: boolean;
  busy: boolean;
  isSelected: (id: Id) => boolean;
  toggle: (id: Id) => void;
};

const RecordDeleteContext = createContext<RecordDeleteContextValue | null>(null);

/**
 * Wraps a server-rendered table so its rows can carry delete controls.
 * `bulk` (administrators) adds row checkboxes and a select-all bar. The API re-checks
 * permission for every request.
 */
export function RecordDeleteScope({
  apiBase,
  noun,
  ids,
  bulk,
  children,
}: {
  apiBase: string;
  noun: string;
  ids: Id[];
  bulk: boolean;
  children: ReactNode;
}) {
  const router = useRouter();
  const selection = useBulkSelection<Id>(ids);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const plural = (count: number) => `${count} ${noun}${count === 1 ? "" : "s"}`;

  async function deleteSelected() {
    const selected = selection.selectedIds;
    if (!selected.length) return;
    if (!window.confirm(`Delete ${plural(selected.length)}? This cannot be undone.`)) return;
    setBusy(true);
    setError(null);
    const { deleted, failed } = await bulkDelete(selected, (id) => `${apiBase}/${id}`);
    setBusy(false);
    setError(bulkDeleteMessage(failed, deleted.length));
    selection.clear();
    router.refresh();
  }

  return (
    <RecordDeleteContext.Provider
      value={{ bulk, busy, isSelected: selection.isSelected, toggle: selection.toggle }}
    >
      {bulk ? (
        <BulkActionBar
          allSelected={selection.allSelected}
          busy={busy}
          count={selection.selectedIds.length}
          onDelete={() => void deleteSelected()}
          onToggleAll={selection.toggleAll}
          someSelected={selection.someSelected}
        />
      ) : null}
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {children}
    </RecordDeleteContext.Provider>
  );
}

/** Row checkbox, shown only to people who may bulk delete. */
export function RecordSelectCell({ id, label }: { id: Id; label: string }) {
  const context = useContext(RecordDeleteContext);
  if (!context?.bulk) return null;
  return (
    <td className="bulk-cell">
      <BulkCheckbox
        checked={context.isSelected(id)}
        disabled={context.busy}
        label={`Select ${label}`}
        onChange={() => context.toggle(id)}
      />
    </td>
  );
}

/** Header cell for the checkbox column; mirrors RecordSelectCell. */
export function RecordSelectHead({ bulk }: { bulk: boolean }) {
  return bulk ? <th className="bulk-cell" /> : null;
}
