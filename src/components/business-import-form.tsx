"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RegionsMap } from "@/components/regions-map";
import type { RegionSelection } from "@/components/regions-map";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";

export function BusinessImportForm({
  categories,
}: {
  categories: string[];
}) {
  const router = useRouter();
  const [source, setSource] = useState("here");
  const [zipCodeInput, setZipCodeInput] = useState("");
  const [selection, setSelection] = useState<RegionSelection | null>(null);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notification, setNotification] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [creatingTask, setCreatingTask] = useState(false);
  const [categoryQuery, setCategoryQuery] = useState("");
  const normalizedQuery = categoryQuery.trim().toLowerCase();
  const visibleCategories = normalizedQuery
    ? categories.filter((category) => category.toLowerCase().includes(normalizedQuery))
    : categories;
  const allCategoriesSelected =
    visibleCategories.length > 0 &&
    visibleCategories.every((category) => selectedCategories.includes(category));

  function toggleCategory(category: string) {
    setNotification(null);
    setSelectedCategories((current) =>
      current.includes(category)
        ? current.filter((item) => item !== category)
        : [...current, category],
    );
  }

  function toggleAllCategories() {
    setNotification(null);
    setSelectedCategories((current) =>
      allCategoriesSelected
        ? current.filter((category) => !visibleCategories.includes(category))
        : [...new Set([...current, ...visibleCategories])],
    );
  }

  async function findZipCode(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotification(null);
    setLoading(true);
    try {
      const response = await fetch(
        `/api/regions/zip-code?code=${encodeURIComponent(zipCodeInput.trim())}`,
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
      setZipCodeInput(result.feature.properties.code);
    } catch (lookupError) {
      console.error("Business import ZIP code lookup failed:", lookupError);
      setError("The ZIP code lookup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  }

  async function launchImportTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotification(null);
    if (source !== "here") {
      setNotification(
        "Feature Not Implemented: this business search source is not available yet.",
      );
      return;
    }
    if (!selection) {
      setError("Select a ZIP code on the map or with Find ZIP before starting a task.");
      return;
    }
    if (selectedCategories.length === 0) {
      setError("Select at least one business category before starting a task.");
      return;
    }

    const formData = new FormData(event.currentTarget);
    const limit = Number(formData.get("limit"));
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > 10_000) {
      setError("The maximum new-business limit must be between 1 and 10,000.");
      return;
    }

    setCreatingTask(true);
    try {
      const response = await fetch("/api/business-import-tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source,
          zipCode: selection.feature.properties.code,
          categories: selectedCategories,
          limit,
        }),
      });
      const result = (await response.json()) as { id?: string; task?: LaunchedTask; error?: string };
      if (!response.ok || !result.id) {
        throw new Error(result.error ?? "Unable to start the import task.");
      }
      if (result.task) announceTaskStarted(result.task);
      router.replace("/businesses");
    } catch (createError) {
      console.error("Business import task creation failed:", createError);
      setError(
        createError instanceof Error
          ? createError.message
          : "Unable to start the import task.",
      );
    } finally {
      setCreatingTask(false);
    }
  }

  return (
    <div className="business-import-layout">
      <section className="panel business-import-map-panel">
        <div className="panel-heading">
          <h2>1. Choose a ZIP code</h2>
        </div>
        <form className="business-import-zip-form" onSubmit={findZipCode}>
          <label className="business-field" htmlFor="business-import-zip">
            <span>Enter a ZIP code</span>
            <input
              autoComplete="postal-code"
              id="business-import-zip"
              inputMode="numeric"
              maxLength={5}
              onChange={(event) => {
                setZipCodeInput(event.target.value);
                setSelection(null);
                setError(null);
              }}
              pattern="\d{5}"
              placeholder="e.g. 33446"
              value={zipCodeInput}
            />
          </label>
          <button
            className="button button-secondary"
            disabled={loading || zipCodeInput.trim().length !== 5}
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
              setZipCodeInput(nextSelection.feature.properties.code);
            }
          }}
          selectionMaxZoom={15}
          selection={selection}
        />
        <p className="regions-map-attribution">
          Click a point on the map or enter a ZIP code to select an area.
          Boundaries are 2020 Census ZCTAs, an approximation of USPS ZIP code
          areas.
        </p>
        <div aria-live="polite" className="business-import-zip-selection">
          {loading ? (
            <span>Finding ZIP code…</span>
          ) : error ? (
            <span className="regions-error" role="status">{error}</span>
          ) : selection ? (
            <>
              <span className="muted">Selected ZIP code</span>
              <strong>{selection.feature.properties.code}</strong>
            </>
          ) : (
            <span className="muted">No ZIP code selected</span>
          )}
        </div>
      </section>

      <section className="panel business-import-options">
        <div className="panel-heading">
          <h2>2. Configure import</h2>
        </div>
        <form className="business-form" onSubmit={launchImportTask}>
          <label className="business-field" htmlFor="business-import-source">
            <span>Search source</span>
            <select
              id="business-import-source"
              onChange={(event) => {
                setSource(event.target.value);
                setNotification(null);
              }}
              value={source}
            >
              <option value="here">HERE Maps</option>
              <option value="google-places">Google Places</option>
              <option value="overpass">Overpass</option>
              <option value="yelp-fusion">Yelp Fusion</option>
              <option value="foursquare-places">Foursquare Places</option>
            </select>
          </label>

          <fieldset className="business-import-categories">
            <legend>Categories</legend>
            <p className="muted">
              Select business categories to include in the search.
            </p>
            {categories.length ? (
              <div className="business-import-category-list">
                <input
                  aria-label="Search categories"
                  onChange={(event) => setCategoryQuery(event.target.value)}
                  placeholder="Search categories…"
                  type="search"
                  value={categoryQuery}
                />
                <label className="business-import-category business-import-select-all">
                  <input
                    checked={allCategoriesSelected}
                    onChange={toggleAllCategories}
                    type="checkbox"
                  />
                  <span>
                    {allCategoriesSelected
                      ? normalizedQuery ? "Deselect all matching" : "Deselect all categories"
                      : normalizedQuery ? "Select all matching" : "Select all categories"}
                    {selectedCategories.length
                      ? ` (${selectedCategories.length} selected)`
                      : ""}
                  </span>
                </label>
                {visibleCategories.length === 0 ? (
                  <p className="empty-state">No categories match your search.</p>
                ) : null}
                {visibleCategories.map((category) => (
                  <label className="business-import-category" key={category}>
                    <input
                      checked={selectedCategories.includes(category)}
                      onChange={() => toggleCategory(category)}
                      type="checkbox"
                    />
                    <span>{category}</span>
                  </label>
                ))}
              </div>
            ) : (
              <p className="empty-state">
                No categories are available yet. Categories will appear here
                once businesses have category data.
              </p>
            )}
          </fieldset>

          <label className="business-field">
            <span>Maximum new businesses</span>
            <input
              defaultValue={100}
              max={10_000}
              min={1}
              name="limit"
              type="number"
            />
            <small className="muted">
              Limits the number of new businesses added by this import (1–10,000).
            </small>
          </label>

          <div className="business-form-footer business-import-footer">
            {error ? (
              <p aria-live="polite" className="form-error" role="alert">
                {error}
              </p>
            ) : notification ? (
              <p
                aria-live="polite"
                className={
                  source === "here"
                    ? "business-import-notification"
                    : "business-import-notification business-import-notification-error"
                }
                role="status"
              >
                {notification}
              </p>
            ) : (
              <p className="muted">
                Choose the search area, categories, and maximum new businesses.
              </p>
            )}
            <button
              className="button button-primary"
              disabled={creatingTask}
              type="submit"
            >
              {creatingTask ? "Starting…" : "Create import task"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
