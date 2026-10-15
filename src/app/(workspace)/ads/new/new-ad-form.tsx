"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { createAdvertisement } from "@/app/actions/ads";
import { AdStyleField, useAdPricing, type AdStyleOption } from "@/components/ad-style-field";

interface Business {
  id: number;
  name: string;
  primaryCategory: string | null;
}
interface Issue {
  id: string;
  name: string;
  issueName: string;
  publicationId: number;
}

export function NewAdForm({
  businesses,
  issues,
  styles,
}: {
  businesses: Business[];
  issues: Issue[];
  styles: AdStyleOption[];
}) {
  const [name, setName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [bizQuery, setBizQuery] = useState("");
  const [bizOpen, setBizOpen] = useState(false);
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [issueQuery, setIssueQuery] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<Issue[]>([]);
  const pricing = useAdPricing({ options: styles, issues: selectedIssues });
  const bizRef = useRef<HTMLDivElement>(null);
  const bizInputRef = useRef<HTMLInputElement>(null);
  const issueRef = useRef<HTMLDivElement>(null);
  const issueInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (bizRef.current && !bizRef.current.contains(e.target as Node)) {
        setBizOpen(false);
        if (!selectedBiz) setBizQuery("");
      }
      if (issueRef.current && !issueRef.current.contains(e.target as Node)) {
        setIssueOpen(false);
        setIssueQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [selectedBiz]);

  const filteredBiz = businesses.filter((b) => {
    const q = bizQuery.toLowerCase();
    return (
      b.name.toLowerCase().includes(q) ||
      (b.primaryCategory?.toLowerCase().includes(q) ?? false)
    );
  });

  const selectedIssueIds = new Set(selectedIssues.map((p) => p.id));
  const filteredIssues = issueQuery
    ? issues.filter(
        (p) =>
          !selectedIssueIds.has(p.id) &&
          p.name.toLowerCase().includes(issueQuery.toLowerCase())
      )
    : [];

  // Keep the name in sync with the selections until the user edits it by hand.
  useEffect(() => {
    if (nameEdited) return;
    const parts: string[] = [];
    if (selectedBiz) parts.push(selectedBiz.name);
    if (selectedIssues.length === 1) parts.push(selectedIssues[0].issueName);
    else if (selectedIssues.length > 1) parts.push("Multi Issue");
    setName(parts.join(" - "));
  }, [nameEdited, selectedBiz, selectedIssues]);

  function selectBiz(b: Business) {
    setSelectedBiz(b);
    setBizQuery(b.name);
    setBizOpen(false);
  }

  function clearBiz() {
    setSelectedBiz(null);
    setBizQuery("");
    setBizOpen(true);
    setTimeout(() => bizInputRef.current?.focus(), 0);
  }

  function addIssue(p: Issue) {
    setSelectedIssues((prev) => [...prev, p]);
    setIssueQuery("");
    issueInputRef.current?.focus();
  }

  function removeIssue(id: string) {
    setSelectedIssues((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <form action={createAdvertisement} className="business-form">
      <div className="business-form-grid">
        <div className="business-field business-field-wide" ref={bizRef}>
          <span>Business <span aria-hidden="true">*</span></span>
          <div className="search-select">
            <div className="search-select-input-wrap">
              <input
                ref={bizInputRef}
                type="text"
                placeholder="Search businesses…"
                autoComplete="off"
                value={bizQuery}
                onChange={(e) => {
                  setBizQuery(e.target.value);
                  setSelectedBiz(null);
                  setBizOpen(true);
                }}
                onFocus={() => setBizOpen(true)}
                aria-haspopup="listbox"
                aria-expanded={bizOpen}
              />
              {bizQuery && (
                <button
                  type="button"
                  className="search-select-clear"
                  onClick={clearBiz}
                  aria-label="Clear selection"
                >
                  ✕
                </button>
              )}
            </div>
            {bizOpen && (
              <ul className="search-select-dropdown" role="listbox">
                {filteredBiz.length ? (
                  filteredBiz.map((b) => (
                    <li
                      key={b.id}
                      role="option"
                      aria-selected={selectedBiz?.id === b.id}
                      className={`search-select-option${selectedBiz?.id === b.id ? " selected" : ""}`}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        selectBiz(b);
                      }}
                    >
                      <strong>{b.name}</strong>
                      {b.primaryCategory && (
                        <span className="search-select-meta"> — {b.primaryCategory}</span>
                      )}
                    </li>
                  ))
                ) : (
                  <li className="search-select-none">No businesses match "{bizQuery}"</li>
                )}
              </ul>
            )}
          </div>
          <input
            type="hidden"
            name="businessId"
            value={selectedBiz?.id ?? ""}
            required
          />
        </div>

        <div className="business-field business-field-wide" ref={issueRef}>
          <span>Issues <span className="muted">(optional for now — required before publishing)</span></span>
          {selectedIssues.map((p) => (
            <input key={p.id} type="hidden" name="issueIds" value={p.id} />
          ))}
          {issues.length ? (
            <div className="search-select">
              {selectedIssues.length > 0 && (
                <div className="search-select-tags">
                  {selectedIssues.map((p) => (
                    <span key={p.id} className="search-select-tag">
                      {p.name}
                      <button
                        type="button"
                        className="search-select-tag-remove"
                        onClick={() => removeIssue(p.id)}
                        aria-label={`Remove ${p.name}`}
                      >
                        ✕
                      </button>
                    </span>
                  ))}
                </div>
              )}
              <div className="search-select-input-wrap">
                <input
                  ref={issueInputRef}
                  type="text"
                  placeholder="Search issues…"
                  autoComplete="off"
                  value={issueQuery}
                  onChange={(e) => {
                    setIssueQuery(e.target.value);
                    setIssueOpen(true);
                  }}
                  onFocus={() => { if (issueQuery) setIssueOpen(true); }}
                  aria-haspopup="listbox"
                  aria-expanded={issueOpen}
                />
                {issueQuery && (
                  <button
                    type="button"
                    className="search-select-clear"
                    onClick={() => { setIssueQuery(""); setIssueOpen(false); issueInputRef.current?.focus(); }}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
              {issueOpen && issueQuery && (
                <ul className="search-select-dropdown" role="listbox">
                  {filteredIssues.length ? (
                    filteredIssues.map((p) => (
                      <li
                        key={p.id}
                        role="option"
                        aria-selected={false}
                        className="search-select-option"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addIssue(p);
                        }}
                      >
                        <strong>{p.name}</strong>
                      </li>
                    ))
                  ) : (
                    <li className="search-select-none">No issues match &ldquo;{issueQuery}&rdquo;</li>
                  )}
                </ul>
              )}
            </div>
          ) : (
            <p className="muted">No issues available. Create an issue first.</p>
          )}
        </div>
        <AdStyleField issues={selectedIssues} options={styles} pricing={pricing} />
        <label className="business-field business-field-wide">
          <span>Name <span aria-hidden="true">*</span></span>
          <input
            maxLength={200}
            name="title"
            onChange={(e) => {
              setName(e.target.value);
              setNameEdited(e.target.value !== "");
            }}
            required
            value={name}
          />
        </label>
      </div>

      <div className="business-form-footer">
        <p className="muted">The ad will start as Draft. The name fills in from the business and issue; edit it if you prefer.</p>
        <div className="business-form-actions">
          <Link className="text-link" href="/ads">Cancel</Link>
          <button className="button button-primary" type="submit">Create advertisement</button>
        </div>
      </div>
    </form>
  );
}
