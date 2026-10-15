"use client";

import { useActionState, useState } from "react";
import {
  updatePublicationRates,
  type PublicationRatesActionState,
} from "@/app/actions/publications";

type RateKind = "AD" | "ARTICLE";

export type PublicationRate = {
  id: number;
  kind: RateKind;
  name: string;
  description: string;
  priceCents: number;
};

type RateRow = {
  /** Stable React key; new rows have no database id yet. */
  key: string;
  id: number | null;
  kind: RateKind;
  name: string;
  description: string;
  price: string;
};

const KIND_LABELS: Record<RateKind, { title: string; add: string; placeholder: string }> = {
  AD: { title: "Ads", add: "Add rate", placeholder: "Half-page ad" },
  ARTICLE: { title: "Articles", add: "Add rate", placeholder: "Sponsored feature" },
};

const initialState: PublicationRatesActionState = {};

let nextKey = 0;

function toRow(rate: PublicationRate): RateRow {
  return {
    key: `rate-${rate.id}`,
    id: rate.id,
    kind: rate.kind,
    name: rate.name,
    description: rate.description,
    price: String(rate.priceCents / 100),
  };
}

/** Edits a publication's rate card: the ad and article packages the Marketer sells, priced per issue. */
export function PublicationRatesEditor({ publicationId, rates }: { publicationId: number; rates: PublicationRate[] }) {
  const [rows, setRows] = useState<RateRow[]>(() => rates.map(toRow));
  const [actionState, formAction, pending] = useActionState(updatePublicationRates, initialState);
  const [syncedState, setSyncedState] = useState(actionState);
  // Adopt the saved rate card (with ids for new rows) once per save.
  if (syncedState !== actionState) {
    setSyncedState(actionState);
    if (actionState.saved) setRows(actionState.saved.map(toRow));
  }

  function updateRow(key: string, patch: Partial<RateRow>) {
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  }

  function addRow(kind: RateKind) {
    nextKey += 1;
    setRows((current) => [...current, { key: `new-${nextKey}`, id: null, kind, name: "", description: "", price: "" }]);
  }

  const payload = JSON.stringify(
    rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      name: row.name,
      description: row.description,
      priceUsd: Number(row.price),
    })),
  );

  return (
    <form action={formAction} className="publication-rates-form">
      <input name="id" readOnly type="hidden" value={publicationId} />
      <input name="rates" readOnly type="hidden" value={payload} />
      {(["AD", "ARTICLE"] as const).map((kind) => {
        const kindRows = rows.filter((row) => row.kind === kind);
        return (
          <div className="publication-rates-group" key={kind}>
            <div className="publication-rates-group-heading">
              <h3>{KIND_LABELS[kind].title}</h3>
              <button className="button button-small button-secondary" onClick={() => addRow(kind)} type="button">
                {KIND_LABELS[kind].add}
              </button>
            </div>
            {kindRows.length ? (
              <div className="table-wrap">
                <table className="publication-rates-table">
                  <thead>
                    <tr>
                      <th className="publication-rates-col-name">Type</th>
                      <th>Description</th>
                      <th className="publication-rates-col-price">Price (USD)</th>
                      <th aria-label="Actions" className="publication-rates-col-actions" />
                    </tr>
                  </thead>
                  <tbody>
                    {kindRows.map((row) => (
                      <tr key={row.key}>
                        <td>
                          <input
                            aria-label="Type"
                            maxLength={120}
                            onChange={(event) => updateRow(row.key, { name: event.target.value })}
                            placeholder={KIND_LABELS[kind].placeholder}
                            required
                            type="text"
                            value={row.name}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="Package description"
                            maxLength={500}
                            onChange={(event) => updateRow(row.key, { description: event.target.value })}
                            type="text"
                            value={row.description}
                          />
                        </td>
                        <td>
                          <input
                            aria-label="Price per issue in US dollars"
                            className="publication-rates-price"
                            min={0}
                            onChange={(event) => updateRow(row.key, { price: event.target.value })}
                            required
                            step={1}
                            type="number"
                            value={row.price}
                          />
                        </td>
                        <td className="publication-rates-actions">
                          <button
                            className="button button-small button-danger"
                            onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
                            type="button"
                          >
                            Remove
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="empty-state">No {KIND_LABELS[kind].title.toLowerCase()} rates. The Marketer will not quote prices for them.</div>
            )}
          </div>
        );
      })}
      {actionState.error ? (
        <p aria-live="polite" className="form-error" role="alert">{actionState.error}</p>
      ) : actionState.saved ? (
        <p aria-live="polite" className="muted" role="status">Rates saved.</p>
      ) : null}
      <div className="publication-form-footer">
        <p className="muted">Removing a rate does not change deals already agreed at that price.</p>
        <button className="button button-primary" disabled={pending} type="submit">
          {pending ? "Saving…" : "Save rates"}
        </button>
      </div>
    </form>
  );
}
