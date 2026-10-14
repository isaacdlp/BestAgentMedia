"use client";

import { useState } from "react";
import Link from "next/link";
import { RegionsMap } from "@/components/regions-map";
import type { RegionSelection } from "@/components/regions-map";

export function RegionsWorkspace() {
  const [zipCode, setZipCode] = useState("");
  const [selection, setSelection] = useState<RegionSelection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function findZipCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const response = await fetch(
        `/api/regions/zip-code?code=${encodeURIComponent(zipCode.trim())}`,
      );
      const result = (await response.json()) as
        | RegionSelection
        | { error: string };

      if (!response.ok) {
        setError(
          "error" in result
            ? result.error
            : "Unable to find that ZIP code boundary.",
        );
        return;
      }
      if (
        !("feature" in result) ||
        !/^\d{5}$/.test(result.feature.properties.code)
      ) {
        throw new Error("The ZIP code lookup returned invalid map data.");
      }

      setSelection(result);
      setZipCode(result.feature.properties.code);
    } catch (lookupError) {
      console.error("Regions ZIP code lookup failed:", lookupError);
      setError("The ZIP code lookup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">GEOGRAPHY</p>
          <h1>Regions</h1>
          <p className="muted">
            Click a location on the map to find its ZIP code and publications.
          </p>
        </div>
      </div>
      <div className="regions-layout">
        <section
          aria-label="United States ZIP code map"
          className="panel regions-map-panel"
        >
          <form className="regions-zip-lookup-form" onSubmit={findZipCode}>
            <label className="business-field" htmlFor="regions-zip-code">
              <span>Enter a ZIP code</span>
              <input
                autoComplete="postal-code"
                id="regions-zip-code"
                inputMode="numeric"
                maxLength={5}
                onChange={(event) => {
                  setZipCode(event.target.value);
                  setSelection(null);
                  setError(null);
                }}
                pattern="\d{5}"
                placeholder="e.g. 33446"
                value={zipCode}
              />
            </label>
            <button
              className="button button-secondary"
              disabled={loading || zipCode.trim().length !== 5}
              type="submit"
            >
              {loading ? "Finding…" : "Find ZIP"}
            </button>
          </form>
          <RegionsMap
            onError={setError}
            onLoadingChange={setLoading}
            onSelect={(nextSelection) => {
              setSelection(nextSelection);
              if (nextSelection) {
                setZipCode(nextSelection.feature.properties.code);
              }
            }}
            selection={selection}
          />
          <p className="regions-map-attribution">
            ZIP boundaries are 2020 Census ZCTAs, an approximation of USPS ZIP
            code areas.
          </p>
        </section>
        <aside aria-live="polite" className="panel regions-details">
          {loading ? (
            <div className="empty-state">Finding ZIP code…</div>
          ) : error ? (
            <div className="empty-state regions-error" role="status">
              {error}
            </div>
          ) : selection ? (
            <>
              <p className="eyebrow">SELECTED ZIP CODE</p>
              <h2 className="region-zip-code">
                {selection.feature.properties.code}
              </h2>
              <p className="muted">
                The highlighted polygon shows the Census ZCTA boundary.
              </p>
              <div className="region-publications">
                <h3>Associated publications</h3>
                {selection.publications.length ? (
                  <ul className="region-publication-list">
                    {selection.publications.map((publication) => (
                      <li className="region-publication" key={publication.id}>
                        <Link
                          className="text-link"
                          href={`/publications/${publication.id}`}
                        >
                          {publication.coverImageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              alt={`${publication.name} cover`}
                              className="region-publication-cover"
                              src={publication.coverImageUrl}
                            />
                          ) : null}
                          <span>{publication.name}</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="muted">
                    No publications are currently associated with this ZIP code.
                  </p>
                )}
              </div>
            </>
          ) : (
            <div className="empty-state">
              Select any point in the United States to inspect its ZIP code.
            </div>
          )}
        </aside>
      </div>
    </>
  );
}
