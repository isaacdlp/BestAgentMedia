"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { updateAdvertisement } from "@/app/actions/ads";
import { AdStyleField, useAdPricing, type AdStyleOption } from "@/components/ad-style-field";

interface Issue {
  id: string;
  name: string;
  publicationId: number;
}

export function AdDetailForm({
  adId,
  title,
  description,
  businessId,
  businessName,
  allIssues,
  initialIssues,
  styles,
  initialStyleId,
  initialCostCents,
}: {
  adId: string;
  title: string;
  description: string | null;
  businessId: number;
  businessName: string;
  allIssues: Issue[];
  initialIssues: Issue[];
  styles: AdStyleOption[];
  initialStyleId: number | null;
  initialCostCents: number | null;
}) {
  const [issueQuery, setIssueQuery] = useState("");
  const [issueOpen, setIssueOpen] = useState(false);
  const [selectedIssues, setSelectedIssues] = useState<Issue[]>(initialIssues);
  const issueRef = useRef<HTMLDivElement>(null);
  const issueInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (issueRef.current && !issueRef.current.contains(e.target as Node)) {
        setIssueOpen(false);
        setIssueQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const pricing = useAdPricing({
    options: styles,
    issues: selectedIssues,
    initialStyleId: initialStyleId === null ? "" : String(initialStyleId),
    initialCostCents,
  });

  const selectedIssueIds = new Set(selectedIssues.map((p) => p.id));
  const filteredIssues = issueQuery
    ? allIssues.filter(
        (p) =>
          !selectedIssueIds.has(p.id) &&
          p.name.toLowerCase().includes(issueQuery.toLowerCase())
      )
    : [];

  function addIssue(p: Issue) {
    setSelectedIssues((prev) => [...prev, p]);
    setIssueQuery("");
    issueInputRef.current?.focus();
  }

  function removeIssue(id: string) {
    setSelectedIssues((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <form action={updateAdvertisement} className="business-form">
      <input name="id" type="hidden" value={adId} />
      <div className="business-form-grid">
        <label className="business-field business-field-wide">
          <span>Ad name <span aria-hidden="true">*</span></span>
          <input defaultValue={title} maxLength={200} name="title" required />
        </label>

        <label className="business-field business-field-wide">
          <span>Description</span>
          <textarea defaultValue={description ?? ""} name="description" rows={3} />
        </label>

        <div className="business-field">
          <span>Business</span>
          <p style={{ padding: "0.5rem 0" }}>
            <Link className="text-link" href={`/businesses/${businessId}`}>
              {businessName}
            </Link>
          </p>
        </div>

        <div className="business-field business-field-wide" ref={issueRef}>
          <span>Issues</span>
          {selectedIssues.map((p) => (
            <input key={p.id} type="hidden" name="issueIds" value={p.id} />
          ))}
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
        </div>
        <AdStyleField issues={selectedIssues} options={styles} pricing={pricing} />
      </div>
      <div className="business-form-footer">
        <p className="muted">
          Record ID: {adId}
        </p>
        <button className="button button-primary" type="submit">Save changes</button>
      </div>
    </form>
  );
}
