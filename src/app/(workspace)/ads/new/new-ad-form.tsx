"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { createAdvertisement } from "@/app/actions/ads";

interface Business {
  id: number;
  name: string;
  primaryCategory: string | null;
}
interface Publication {
  id: number;
  name: string;
}

export function NewAdForm({
  businesses,
  publications,
}: {
  businesses: Business[];
  publications: Publication[];
}) {
  const [bizQuery, setBizQuery] = useState("");
  const [bizOpen, setBizOpen] = useState(false);
  const [selectedBiz, setSelectedBiz] = useState<Business | null>(null);
  const [pubQuery, setPubQuery] = useState("");
  const [pubOpen, setPubOpen] = useState(false);
  const [selectedPubs, setSelectedPubs] = useState<Publication[]>([]);
  const bizRef = useRef<HTMLDivElement>(null);
  const bizInputRef = useRef<HTMLInputElement>(null);
  const pubRef = useRef<HTMLDivElement>(null);
  const pubInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (bizRef.current && !bizRef.current.contains(e.target as Node)) {
        setBizOpen(false);
        if (!selectedBiz) setBizQuery("");
      }
      if (pubRef.current && !pubRef.current.contains(e.target as Node)) {
        setPubOpen(false);
        setPubQuery("");
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

  const selectedPubIds = new Set(selectedPubs.map((p) => p.id));
  const filteredPubs = pubQuery
    ? publications.filter(
        (p) =>
          !selectedPubIds.has(p.id) &&
          p.name.toLowerCase().includes(pubQuery.toLowerCase())
      )
    : [];

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

  function addPub(p: Publication) {
    setSelectedPubs((prev) => [...prev, p]);
    setPubQuery("");
    pubInputRef.current?.focus();
  }

  function removePub(id: number) {
    setSelectedPubs((prev) => prev.filter((p) => p.id !== id));
  }

  return (
    <form action={createAdvertisement} className="business-form">
      <div className="business-form-grid">
        <label className="business-field business-field-wide">
          <span>Ad name <span aria-hidden="true">*</span></span>
          <input maxLength={200} name="title" required />
        </label>

        <label className="business-field business-field-wide">
          <span>Description</span>
          <textarea name="description" rows={3} placeholder="What this ad is about..." />
        </label>

        <label className="business-field business-field-wide">
          <span>Call to action URL</span>
          <input name="cta" type="url" placeholder="https://example.com" />
        </label>

        <div className="business-field" ref={bizRef}>
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

        <div className="business-field business-field-wide" ref={pubRef}>
          <span>Publications <span aria-hidden="true">*</span></span>
          {selectedPubs.map((p) => (
            <input key={p.id} type="hidden" name="publicationIds" value={p.id} />
          ))}
          {publications.length ? (
            <div className="search-select">
              {selectedPubs.length > 0 && (
                <div className="search-select-tags">
                  {selectedPubs.map((p) => (
                    <span key={p.id} className="search-select-tag">
                      {p.name}
                      <button
                        type="button"
                        className="search-select-tag-remove"
                        onClick={() => removePub(p.id)}
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
                  ref={pubInputRef}
                  type="text"
                  placeholder="Search publications…"
                  autoComplete="off"
                  value={pubQuery}
                  onChange={(e) => {
                    setPubQuery(e.target.value);
                    setPubOpen(true);
                  }}
                  onFocus={() => { if (pubQuery) setPubOpen(true); }}
                  aria-haspopup="listbox"
                  aria-expanded={pubOpen}
                />
                {pubQuery && (
                  <button
                    type="button"
                    className="search-select-clear"
                    onClick={() => { setPubQuery(""); setPubOpen(false); pubInputRef.current?.focus(); }}
                    aria-label="Clear search"
                  >
                    ✕
                  </button>
                )}
              </div>
              {pubOpen && pubQuery && (
                <ul className="search-select-dropdown" role="listbox">
                  {filteredPubs.length ? (
                    filteredPubs.map((p) => (
                      <li
                        key={p.id}
                        role="option"
                        aria-selected={false}
                        className="search-select-option"
                        onMouseDown={(e) => {
                          e.preventDefault();
                          addPub(p);
                        }}
                      >
                        <strong>{p.name}</strong>
                      </li>
                    ))
                  ) : (
                    <li className="search-select-none">No publications match &ldquo;{pubQuery}&rdquo;</li>
                  )}
                </ul>
              )}
            </div>
          ) : (
            <p className="muted">No publications available.</p>
          )}
        </div>
      </div>

      <div className="business-form-footer">
        <p className="muted">Ad status will start as Draft.</p>
        <div className="business-form-actions">
          <Link className="text-link" href="/ads">Cancel</Link>
          <button className="button button-primary" type="submit">Create advertisement</button>
        </div>
      </div>
    </form>
  );
}
