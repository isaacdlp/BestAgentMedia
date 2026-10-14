"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { buildIssueName, slugify } from "@/lib/issue-naming";

type PublicationOption = {
  id: number;
  name: string;
  coverImageUrl: string | null;
};

export function IssueCreateForm({
  action,
  defaultDate,
  initialPublicationId = null,
  publications,
}: {
  action: (formData: FormData) => void | Promise<void>;
  defaultDate: string;
  initialPublicationId?: number | null;
  publications: PublicationOption[];
}) {
  const [query, setQuery] = useState("");
  const [selectedId, setSelectedId] = useState<number | null>(
    publications.some((publication) => publication.id === initialPublicationId)
      ? initialPublicationId
      : null,
  );
  const [publicationDate, setPublicationDate] = useState(defaultDate);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [slugEdited, setSlugEdited] = useState(false);
  const selected = publications.find((publication) => publication.id === selectedId) ?? null;
  const generatedName = selected ? buildIssueName(selected.name, publicationDate) : "";
  const generatedSlug = slugify(generatedName);
  const effectiveName = nameEdited ? name : generatedName;
  const effectiveSlug = slugEdited ? slug : nameEdited ? slugify(name) : generatedSlug;
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    return term
      ? publications.filter((publication) => publication.name.toLowerCase().includes(term))
      : publications;
  }, [publications, query]);

  return (
    <form action={action} className="issue-create-layout">
      <div className="issue-create-fields">
        <input name="publicationId" type="hidden" value={selectedId ?? ""} readOnly />
        <label className="business-field">
          <span>Search publications</span>
          <input
            autoComplete="off"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Type a publication name…"
            type="search"
            value={query}
          />
        </label>
        <ul aria-label="Publications" className="issue-publication-results" role="listbox">
          {matches.length ? (
            matches.map((publication) => (
              <li key={publication.id}>
                <button
                  aria-selected={publication.id === selectedId}
                  className={`issue-publication-option${publication.id === selectedId ? " is-selected" : ""}`}
                  onClick={() => setSelectedId(publication.id)}
                  role="option"
                  type="button"
                >
                  {publication.name}
                </button>
              </li>
            ))
          ) : (
            <li className="muted issue-publication-empty">No publications match “{query}”.</li>
          )}
        </ul>
        <label className="business-field">
          <span>Publication date</span>
          <input
            name="publicationDate"
            onChange={(event) => setPublicationDate(event.target.value)}
            required
            type="date"
            value={publicationDate}
          />
        </label>
        <label className="business-field">
          <span>Name</span>
          <input
            name="name"
            onChange={(event) => {
              setName(event.target.value);
              setNameEdited(true);
            }}
            required
            type="text"
            value={effectiveName}
          />
        </label>
        <label className="business-field">
          <span>Slug</span>
          <input
            name="slug"
            onChange={(event) => {
              setSlug(event.target.value);
              setSlugEdited(true);
            }}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            required
            type="text"
            value={effectiveSlug}
          />
        </label>
        <label className="business-field">
          <span>Description</span>
          <textarea name="description" rows={3} />
        </label>
        <div className="business-form-actions">
          <button className="button button-primary" disabled={!selected} type="submit">
            Create issue
          </button>
          <Link className="button button-secondary" href="/issues">Cancel</Link>
        </div>
      </div>
      <aside className="issue-publication-preview">
        {selected ? (
          <Link className="issue-publication-preview-link" href={`/publications/${selected.id}`}>
            {selected.coverImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt={`${selected.name} cover`}
                className="issue-publication-preview-cover"
                src={selected.coverImageUrl}
              />
            ) : (
              <span className="issue-publication-preview-placeholder">No cover</span>
            )}
            <span className="text-link">{selected.name}</span>
          </Link>
        ) : (
          <p className="muted">Select a publication to see its cover.</p>
        )}
      </aside>
    </form>
  );
}
