"use client";

import { useId, useMemo, useRef, useState, type KeyboardEvent } from "react";

const maximumResults = 50;

export type SearchSelectOption = {
  id: number;
  label: string;
  /** Secondary line shown under the label (for example city, ZIP, category). */
  detail?: string;
  /** Extra searchable text that is not displayed (for example every ZIP code served). */
  keywords?: string[];
};

/**
 * Searchable single-record picker for forms: type to filter every option by its label, detail and
 * keywords, pick with the mouse or arrow keys + Enter. Submits the chosen record ID as a hidden
 * `name` field (empty when nothing is linked and `noneLabel` allows clearing).
 */
export function SearchSelect({
  label,
  name,
  options,
  initialValue,
  noneLabel,
  placeholder = "Search…",
  required = false,
  onChange,
  showSelectedDetail = true,
}: {
  label: string;
  name: string;
  options: SearchSelectOption[];
  initialValue: number | null;
  /** When set, the selection can be cleared and this text describes the empty state. */
  noneLabel?: string;
  placeholder?: string;
  required?: boolean;
  onChange?: (id: number | null) => void;
  /** Show the chosen record's detail line under the field (default true). */
  showSelectedDetail?: boolean;
}) {
  const inputId = useId();
  const listId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [selectedId, setSelectedId] = useState<number | null>(initialValue);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);

  const selected = options.find((option) => option.id === selectedId) ?? null;

  const searchable = useMemo(
    () =>
      options.map((option) => ({
        option,
        text: [option.label, option.detail ?? "", ...(option.keywords ?? [])].join(" ").toLowerCase(),
      })),
    [options],
  );
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const matches = terms.length
    ? searchable.filter(({ text }) => terms.every((term) => text.includes(term))).map(({ option }) => option)
    : options;
  const results = matches.slice(0, maximumResults);

  function choose(option: SearchSelectOption | null) {
    setSelectedId(option?.id ?? null);
    onChange?.(option?.id ?? null);
    setQuery("");
    setOpen(false);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActiveIndex((index) => Math.min(index + 1, results.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      if (!open) return;
      event.preventDefault();
      if (results[activeIndex]) choose(results[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setQuery("");
      setOpen(false);
    }
  }

  return (
    <div className="business-field search-select">
      <label htmlFor={inputId}>{label}{required ? " *" : ""}</label>
      <input name={name} type="hidden" value={selectedId ?? ""} />
      <div className="search-select-control">
        <input
          aria-activedescendant={open && results[activeIndex] ? `${listId}-${results[activeIndex].id}` : undefined}
          aria-autocomplete="list"
          aria-controls={listId}
          aria-expanded={open}
          autoComplete="off"
          className="search-select-input"
          id={inputId}
          onBlur={() => {
            setOpen(false);
            setQuery("");
          }}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
          onFocus={() => {
            setActiveIndex(0);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          placeholder={selected ? selected.label : noneLabel ?? placeholder}
          ref={inputRef}
          role="combobox"
          type="search"
          value={open ? query : selected?.label ?? ""}
        />
        {selected && noneLabel ? (
          <button
            aria-label={`Clear ${label.toLowerCase()}`}
            className="search-select-clear"
            onClick={() => choose(null)}
            type="button"
          >
            ×
          </button>
        ) : null}
        {open ? (
          <ul className="search-select-results" id={listId} role="listbox">
            {results.map((option, index) => (
              <li
                aria-selected={option.id === selectedId}
                className={`search-select-option${index === activeIndex ? " search-select-option-active" : ""}`}
                id={`${listId}-${option.id}`}
                key={option.id}
                // Keep focus in the input so blur does not close the list before the click lands.
                onMouseDown={(event) => {
                  event.preventDefault();
                  choose(option);
                }}
                onMouseEnter={() => setActiveIndex(index)}
                role="option"
              >
                <span>{option.label}</span>
                {option.detail ? <small>{option.detail}</small> : null}
              </li>
            ))}
            {matches.length > results.length ? (
              <li className="search-select-note">
                {matches.length - results.length} more — keep typing to narrow.
              </li>
            ) : null}
            {results.length === 0 ? <li className="search-select-note">No matches.</li> : null}
          </ul>
        ) : null}
      </div>
      {showSelectedDetail && selected?.detail ? <small className="search-select-detail">{selected.detail}</small> : null}
    </div>
  );
}
