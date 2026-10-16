"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { ImageDropzone } from "@/components/image-dropzone";
import { useAdPricing, type AdStyleOption } from "@/components/ad-style-field";
import { SearchSelect } from "@/components/search-select";
import { formatCents } from "@/lib/promotion-packages";
import { RichTextEditor } from "@/components/rich-text-editor";

type ArticleEditorImage = {
  id: string;
  originalName: string;
  mimeType: string;
  size: number;
};

type ArticleEditorProps = {
  article: {
    id: string;
    title: string;
    body: string;
    status: string;
    issueIds: string[];
    images: ArticleEditorImage[];
    businessId: number | null;
    promotionPackageId?: number | null;
    costCents?: number | null;
  } | null;
  /** Article rates (paid promotion styles) of the issues' publications. */
  promotionStyles?: AdStyleOption[];
  canViewImageDetail?: boolean;
  issues: { id: string; name: string; publicationId: number }[];
  businesses: {
    id: number;
    name: string;
    city: string | null;
    stateCode: string | null;
    postalCode: string | null;
    primaryCategory: string | null;
  }[];
  canEdit: boolean;
};

export function ArticleEditor({
  article,
  issues,
  businesses,
  promotionStyles = [],
  canEdit,
  canViewImageDetail = false,
}: ArticleEditorProps) {
  const [error, setError] = useState("");
  const [issueQuery, setIssueQuery] = useState("");
  const issueTerms = issueQuery.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const [issueOpen, setIssueOpen] = useState(false);
  const [businessId, setBusinessId] = useState<number | null>(article?.businessId ?? null);
  const [selectedIssueIds, setSelectedIssueIds] = useState<string[]>(() => article?.issueIds ?? []);
  const selectedIssues = selectedIssueIds.flatMap((id) => issues.find((issue) => issue.id === id) ?? []);
  const pricing = useAdPricing({
    options: promotionStyles,
    issues: selectedIssues,
    initialStyleId: article?.promotionPackageId ? String(article.promotionPackageId) : "",
    initialCostCents: article?.costCents ?? null,
  });
  const promotionAvailable = promotionStyles.filter((style) =>
    selectedIssues.some((issue) => issue.publicationId === style.publicationId),
  );
  const availableIssues = issues.filter(
    (issue) => !selectedIssueIds.includes(issue.id) && issueTerms.every((term) => issue.name.toLowerCase().includes(term)),
  );
  const [pending, setPending] = useState(false);
  const [newFiles, setNewFiles] = useState<File[]>([]);
  const [imageOrder, setImageOrder] = useState<string[]>(() => article?.images.map((image) => image.id) ?? []);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const imagesById = new Map((article?.images ?? []).map((image) => [image.id, image]));
  const orderedImages = imageOrder.flatMap((id) => (removedIds.includes(id) ? [] : (imagesById.get(id) ?? [])));

  function moveImage(id: string, targetId: string) {
    if (id === targetId) return;
    setImageOrder((current) => {
      const from = current.indexOf(id);
      const to = current.indexOf(targetId);
      if (from < 0 || to < 0) return current;
      const next = [...current];
      next.splice(from, 1);
      next.splice(to, 0, id);
      return next;
    });
  }


  async function saveArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    const formData = new FormData(event.currentTarget);
    if (!String(formData.get("body") ?? "").trim()) {
      setError("The article body is required.");
      return;
    }
    setPending(true);
    try {
      const response = await fetch(
        article ? `/api/articles/${article.id}` : "/api/articles",
        {
          method: article ? "PATCH" : "POST",
          body: formData,
        },
      );
      const result = (await response.json()) as { id?: string; error?: string };
      if (!response.ok || !result.id) {
        setError(result.error ?? "The article could not be saved.");
        return;
      }
      window.location.assign(`/articles/${result.id}`);
    } catch {
      setError("Unable to reach the server. Check your connection and try again.");
    } finally {
      setPending(false);
    }
  }

  return (
    <form className="business-form" onSubmit={saveArticle}>
      {canEdit ? (
        <section className="panel article-edit-panel">
          <div className="business-form-grid">
            <div className="business-field business-field-wide article-issue-picker">
              <span>Issues</span>
              {selectedIssues.map((issue) => (
                <input key={issue.id} name="issueIds" type="hidden" value={issue.id} />
              ))}
              <div className="search-select">
                <div className="search-select-control">
                  <input
                    aria-label="Search issues"
                    autoComplete="off"
                    className="search-select-input"
                    onBlur={() => setIssueOpen(false)}
                    onChange={(event) => {
                      setIssueQuery(event.target.value);
                      setIssueOpen(true);
                    }}
                    onFocus={() => setIssueOpen(true)}
                    placeholder={selectedIssues.length ? "Add another issue…" : "None — search issues by publication, date or status…"}
                    type="search"
                    value={issueQuery}
                  />
                  {issueOpen ? (
                    <ul className="search-select-results" role="listbox">
                      {availableIssues.slice(0, 50).map((issue) => (
                        <li
                          className="search-select-option"
                          key={issue.id}
                          onMouseDown={(event) => {
                            event.preventDefault();
                            setSelectedIssueIds((current) => [...current, issue.id]);
                            setIssueQuery("");
                          }}
                          role="option"
                        >
                          <span>{issue.name}</span>
                        </li>
                      ))}
                      {!availableIssues.length ? <li className="search-select-empty">No matching issues.</li> : null}
                    </ul>
                  ) : null}
                </div>
              </div>
              {selectedIssues.length ? (
                <ul className="tag-cloud">
                  {selectedIssues.map((issue) => (
                    <li className="tag-cloud-tag" key={issue.id}>
                      {issue.name}
                      <button
                        aria-label={`Remove ${issue.name}`}
                        onClick={() => setSelectedIssueIds((current) => current.filter((id) => id !== issue.id))}
                        type="button"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {!issues.length ? <span className="muted">No issues are available in your workspace.</span> : null}
            </div>
            {businesses.length > 0 ? (
              <div className="business-field-wide">
                <SearchSelect
                  initialValue={article?.businessId ?? null}
                  label="Associated business"
                  name="businessId"
                  onChange={setBusinessId}
                  showSelectedDetail={false}
                  noneLabel="None — search by name, category, city or ZIP…"
                  options={businesses.map((business) => ({
                    id: business.id,
                    label: business.name,
                    detail: [
                      business.primaryCategory,
                      [business.city, business.stateCode].filter(Boolean).join(", "),
                      business.postalCode,
                    ].filter(Boolean).join(" · "),
                  }))}
                />
              </div>
            ) : null}
            {businessId !== null ? (
              <div className="business-field-wide article-paid-promotion">
                <h3>Paid Promotion</h3>
                {promotionAvailable.length ? (
                  <div className="business-form-grid">
                    <div className="business-field">
                      <label htmlFor="promotion-style">Style</label>
                      <select
                        id="promotion-style"
                        name="packageId"
                        onChange={(event) => pricing.setStyleId(event.target.value)}
                        value={pricing.selected ? pricing.styleId : ""}
                      >
                        <option value="">No paid promotion</option>
                        {promotionAvailable.map((style) => (
                          <option key={style.id} value={style.id}>
                            {style.name} — {formatCents(style.priceCents)} per issue
                          </option>
                        ))}
                      </select>
                    </div>
                      <div className="business-field">
                        <label htmlFor="promotion-cost">Cost (USD)</label>
                        <input
                          id="promotion-cost"
                          disabled={!pricing.selected}
                          min={0}
                          name="cost"
                          onChange={(event) => pricing.setCost(event.target.value)}
                          step="0.01"
                          type="number"
                          value={pricing.costValue}
                        />
                        {pricing.listPriceCents !== null && pricing.costCents !== pricing.listPriceCents ? (
                          <p className="muted">
                            List price {formatCents(pricing.listPriceCents)} ·{" "}
                            <button className="text-link" onClick={pricing.resetCost} type="button">Reset to list price</button>
                          </p>
                        ) : null}
                      </div>
                  </div>
                ) : (
                  <p className="muted">
                    {selectedIssues.length
                      ? "The selected issues' publications have no article promotion rates yet. Add them under Promotion rates on the publication page."
                      : "Select an issue to see the paid promotion styles offered by its publication."}
                  </p>
                )}
              </div>
            ) : null}
          </div>
        </section>
      ) : null}
      <section className="panel article-edit-panel">
      <div className="business-form-grid">
        <label className="business-field business-field-wide">
          <span>Title</span>
          <input defaultValue={article?.title ?? ""} disabled={!canEdit} maxLength={200} name="title" required />
        </label>
        <div className="business-field business-field-wide">
          <span>Body</span>
          <RichTextEditor ariaLabel="Article body" editable={canEdit} initialValue={article?.body ?? ""} name="body" />
        </div>
      </div>

      {article?.images.length || canEdit ? (
        <section className="article-image-section">
          <h2>Images</h2>
          {canEdit ? (
            <div className="business-form-grid">
              <div className="business-field business-field-wide">
                <ImageDropzone files={newFiles} hint="JPEG, PNG, or WebP · up to 10 MB per image · up to 50 MB per save" name="images" onChange={setNewFiles} />
              </div>
            </div>
          ) : null}
          {canEdit && orderedImages.length > 1 ? (
            <p className="muted">Drag pictures to re-arrange them. The order, first to last, decides how they are placed in the layout.</p>
          ) : null}
          {!article ? null : orderedImages.length ? (
            <ul className="submission-image-grid">
              {orderedImages.map((image, index) => {
                const src = `/api/articles/${article.id}/images/${image.id}`;
                const thumbnail = <Image alt={image.originalName} height={180} src={src} unoptimized width={240} />;
                return (
                  <li
                    className={`${canEdit ? "article-image-draggable" : ""}${draggingId === image.id ? " is-dragging" : ""}${dropTargetId === image.id && draggingId !== image.id ? " is-drop-target" : ""}`}
                    draggable={canEdit}
                    key={image.id}
                    onDragEnd={() => {
                      setDraggingId(null);
                      setDropTargetId(null);
                    }}
                    onDragOver={(event) => {
                      if (!draggingId) return;
                      event.preventDefault();
                      setDropTargetId(image.id);
                    }}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", image.id);
                      setDraggingId(image.id);
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      if (draggingId) moveImage(draggingId, image.id);
                      setDraggingId(null);
                      setDropTargetId(null);
                    }}
                  >
                    {canEdit ? <input name="imageOrder" type="hidden" value={image.id} /> : null}
                    {canViewImageDetail ? (
                      <a
                        aria-label={`View image details for ${image.originalName}`}
                        className="submission-image-thumbnail-link"
                        draggable={false}
                        href={`/articles/${article.id}/images/${image.id}`}
                      >
                        {thumbnail}
                      </a>
                    ) : thumbnail}
                    <span>{index + 1}. {image.originalName} ({(image.size / (1024 * 1024)).toFixed(1)} MB)</span>
                    {canEdit ? (
                      <button className="text-link" onClick={() => setRemovedIds((current) => [...current, image.id])} type="button">
                        Remove
                      </button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="muted">No images attached.</p>
          )}
          {removedIds.map((id) => (
            <input key={id} name="removeImageId" type="hidden" value={id} />
          ))}
        </section>
      ) : null}

      {error ? <p aria-live="polite" className="form-error" role="alert">{error}</p> : null}
      {canEdit ? (
        <div className="publication-form-footer">
          <span className="muted">{article ? "Changes are saved directly to the article." : "The article will start in the selected status."}</span>
          <button className="button button-primary business-save" disabled={pending || !issues.length} type="submit">
            {pending ? "Saving…" : "Save article"}
          </button>
        </div>
      ) : null}
      </section>
    </form>
  );
}
