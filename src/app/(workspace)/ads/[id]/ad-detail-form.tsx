"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { updateAdvertisement } from "@/app/actions/ads";

interface Publication {
  id: number;
  name: string;
}

export function AdDetailForm({
  adId,
  title,
  description,
  cta,
  businessId,
  businessName,
  allPublications,
  initialPublications,
}: {
  adId: string;
  title: string;
  description: string | null;
  cta: string | null;
  businessId: number;
  businessName: string;
  allPublications: Publication[];
  initialPublications: Publication[];
}) {
  const [pubQuery, setPubQuery] = useState("");
  const [pubOpen, setPubOpen] = useState(false);
  const [selectedPubs, setSelectedPubs] = useState<Publication[]>(initialPublications);
  const pubRef = useRef<HTMLDivElement>(null);
  const pubInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (pubRef.current && !pubRef.current.contains(e.target as Node)) {
        setPubOpen(false);
        setPubQuery("");
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selectedPubIds = new Set(selectedPubs.map((p) => p.id));
  const filteredPubs = pubQuery
    ? allPublications.filter(
        (p) =>
          !selectedPubIds.has(p.id) &&
          p.name.toLowerCase().includes(pubQuery.toLowerCase())
      )
    : [];

  function addPub(p: Publication) {
    setSelectedPubs((prev) => [...prev, p]);
    setPubQuery("");
    pubInputRef.current?.focus();
  }

  function removePub(id: number) {
    setSelectedPubs((prev) => prev.filter((p) => p.id !== id));
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

        <label className="business-field business-field-wide">
          <span>Call to action URL</span>
          <input defaultValue={cta ?? ""} name="cta" type="url" />
        </label>

        <div className="business-field">
          <span>Business</span>
          <p style={{ padding: "0.5rem 0" }}>
            <Link className="text-link" href={`/businesses/${businessId}`}>
              {businessName}
            </Link>
          </p>
        </div>

        <div className="business-field business-field-wide" ref={pubRef}>
          <span>Publications</span>
          {selectedPubs.map((p) => (
            <input key={p.id} type="hidden" name="publicationIds" value={p.id} />
          ))}
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
        </div>
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
