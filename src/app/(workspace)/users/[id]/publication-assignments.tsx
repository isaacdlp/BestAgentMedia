"use client";

import Link from "next/link";
import { useMemo, useState } from "react";

type PublicationOption = { id: number; name: string };

type PublicationAssignmentsProps = {
  userId: string;
  publications: PublicationOption[];
  assignedIds: number[];
  action: (formData: FormData) => void | Promise<void>;
};

export function PublicationAssignments({
  userId,
  publications,
  assignedIds,
  action,
}: PublicationAssignmentsProps) {
  const [selected, setSelected] = useState<Set<number>>(() => new Set(assignedIds));
  const [query, setQuery] = useState("");

  const needle = query.trim().toLowerCase();
  const visible = useMemo(
    () =>
      needle
        ? publications.filter((p) => p.name.toLowerCase().includes(needle))
        : publications,
    [publications, needle],
  );

  const dirty =
    selected.size !== assignedIds.length || assignedIds.some((id) => !selected.has(id));

  function toggle(id: number) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function setVisible(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current);
      for (const p of visible) {
        if (checked) next.add(p.id);
        else next.delete(p.id);
      }
      return next;
    });
  }

  return (
    <form action={action} className="business-form">
      <input name="id" type="hidden" value={userId} />
      {[...selected].map((id) => (
        <input key={id} name="publicationIds" type="hidden" value={id} />
      ))}

      <div className="search-select-input-wrap">
        <input
          aria-label="Search publications"
          placeholder="Search publications by name…"
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          style={{
            width: "100%",
            minHeight: 39,
            padding: "9px 10px",
            border: "1px solid #dfe5ea",
            borderRadius: 6,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          margin: "10px 0 6px",
        }}
      >
        <span className="muted">
          <strong>{selected.size}</strong> of {publications.length} assigned
          {needle ? ` · ${visible.length} shown` : ""}
        </span>
        <span style={{ display: "flex", gap: 12 }}>
          <button className="text-link" type="button" onClick={() => setVisible(true)}>
            Select {needle ? "shown" : "all"}
          </button>
          <button className="text-link" type="button" onClick={() => setVisible(false)}>
            Clear {needle ? "shown" : "all"}
          </button>
        </span>
      </div>

      <div className="business-import-category-list" style={{ maxHeight: 360 }}>
        {visible.length ? (
          visible.map((publication) => (
            <div
              className="business-import-category"
              key={publication.id}
              style={{ justifyContent: "space-between" }}
            >
              <label style={{ display: "flex", flex: 1, alignItems: "center", gap: 9, cursor: "pointer" }}>
                <input
                  checked={selected.has(publication.id)}
                  type="checkbox"
                  onChange={() => toggle(publication.id)}
                />
                <span>{publication.name}</span>
              </label>
              <Link
                className="text-link"
                href={`/publications/${publication.id}`}
                title={`Open ${publication.name}`}
              >
                View ↗
              </Link>
            </div>
          ))
        ) : (
          <div className="empty-state">No publications match “{query}”.</div>
        )}
      </div>

      <div className="business-form-footer">
        <p className="muted">{dirty ? "Unsaved changes" : "All changes saved"}</p>
        <button className="button button-primary business-save" disabled={!dirty} type="submit">
          Save publications
        </button>
      </div>
    </form>
  );
}
