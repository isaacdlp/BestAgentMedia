"use client";

import { useState } from "react";

const maximumSuggestions = 30;

/**
 * Tag-style category editor for the Business edit form: selected categories are shown as removable
 * tags and new ones are added by searching the known category list. Submits the selection as a
 * newline-separated `categories` field (what updateBusiness expects). Typing a name that is not in
 * the list and pressing Enter adds it as a custom category.
 */
export function BusinessCategoryPicker({
  options,
  initialSelected,
}: {
  options: string[];
  initialSelected: string[];
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [query, setQuery] = useState("");

  const normalizedQuery = query.trim().toLowerCase();
  const matches = normalizedQuery
    ? options.filter(
        (category) => !selected.includes(category) && category.toLowerCase().includes(normalizedQuery),
      )
    : [];
  const suggestions = matches.slice(0, maximumSuggestions);
  const canAddCustom =
    normalizedQuery.length > 0 &&
    ![...options, ...selected].some((category) => category.toLowerCase() === normalizedQuery);

  function add(category: string) {
    const name = category.trim();
    if (!name) return;
    setSelected((current) => (current.includes(name) ? current : [...current, name]));
    setQuery("");
  }

  function remove(category: string) {
    setSelected((current) => current.filter((item) => item !== category));
  }

  return (
    <fieldset className="business-import-categories business-field-wide">
      <legend>Categories</legend>
      <input name="categories" type="hidden" value={selected.join("\n")} />
      <div className="category-tags">
        {selected.length === 0 ? <span className="muted">No categories yet.</span> : null}
        {selected.map((category) => (
          <span className="category-tag" key={category}>
            {category}
            <button
              aria-label={`Remove ${category}`}
              className="category-tag-remove"
              onClick={() => remove(category)}
              type="button"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        aria-label="Search categories to add"
        className="category-search"
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          const exact = options.find((category) => category.toLowerCase() === normalizedQuery);
          if (exact) add(exact);
          else if (suggestions.length === 1) add(suggestions[0]);
          else if (canAddCustom) add(query);
        }}
        placeholder="Search categories to add…"
        type="search"
        value={query}
      />
      {normalizedQuery ? (
        <div className="category-suggestions">
          {suggestions.map((category) => (
            <button
              className="category-suggestion"
              key={category}
              onClick={() => add(category)}
              type="button"
            >
              + {category}
            </button>
          ))}
          {matches.length > suggestions.length ? (
            <span className="muted">
              {matches.length - suggestions.length} more — keep typing to narrow.
            </span>
          ) : null}
          {canAddCustom ? (
            <button className="category-suggestion" onClick={() => add(query)} type="button">
              + Add “{query.trim()}” as a new category
            </button>
          ) : null}
          {suggestions.length === 0 && !canAddCustom ? (
            <span className="muted">No more categories match.</span>
          ) : null}
        </div>
      ) : null}
    </fieldset>
  );
}
