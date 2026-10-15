"use client";

import Image from "next/image";
import { useState, type FormEvent } from "react";
import { ImageDropzone } from "@/components/image-dropzone";

type ArticleEditorImage = {
  id: string;
  originalName: string;
  caption: string;
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
  } | null;
  canViewImageDetail?: boolean;
  issues: { id: string; name: string }[];
  businesses: { id: number; name: string }[];
  canEdit: boolean;
};

export function ArticleEditor({
  article,
  issues,
  businesses,
  canEdit,
  canViewImageDetail = false,
}: ArticleEditorProps) {
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [newFiles, setNewFiles] = useState<File[]>([]);

  async function saveArticle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setPending(true);
    try {
      const response = await fetch(
        article ? `/api/articles/${article.id}` : "/api/articles",
        {
          method: article ? "PATCH" : "POST",
          body: new FormData(event.currentTarget),
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
      <div className="business-form-grid">
        <label className="business-field business-field-wide">
          <span>Title</span>
          <input defaultValue={article?.title ?? ""} disabled={!canEdit} maxLength={200} name="title" required />
        </label>
        <label className="business-field business-field-wide">
          <span>Body (separate paragraphs with a blank line)</span>
          <textarea defaultValue={article?.body ?? ""} disabled={!canEdit} maxLength={50000} name="body" required rows={12} />
        </label>
        {canEdit ? (
          <>
            <fieldset className="article-publications business-field business-field-wide">
              <legend>Issues</legend>
              <div className="article-publication-options">
                {issues.map((issue) => (
                  <label key={issue.id}>
                    <input
                      defaultChecked={article?.issueIds.includes(issue.id) ?? false}
                      name="issueIds"
                      required={false}
                      type="checkbox"
                      value={issue.id}
                    />
                    {issue.name}
                  </label>
                ))}
              </div>
              {!issues.length ? <span className="muted">No issues are available in your workspace.</span> : null}
            </fieldset>
            <label className="business-field">
              <span>Status</span>
              <select defaultValue={article?.status ?? "DRAFT"} name="status">
                <option value="DRAFT">Draft</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="PUBLISHED">Published</option>
              </select>
            </label>
            {businesses.length > 0 ? (
              <label className="business-field">
                <span>Associated business</span>
                <select defaultValue={article?.businessId ?? ""} name="businessId">
                  <option value="">None</option>
                  {businesses.map((business) => (
                    <option key={business.id} value={business.id}>{business.name}</option>
                  ))}
                </select>
              </label>
            ) : null}
          </>
        ) : (
          <div className="business-field"><span>Status</span><span className="status-pill">{article?.status.toLowerCase()}</span></div>
        )}
      </div>

      {article?.images.length ? (
        <section className="article-image-section">
          <h2>Images and captions</h2>
          <div className="article-image-list">
            {article.images.map((image) => (
              <div className="article-image-card" key={image.id}>
                {canViewImageDetail ? (
                  <a href={`/articles/${article.id}/images/${image.id}`}>
                    <Image
                      alt={image.caption || image.originalName}
                      height={220}
                      src={`/api/articles/${article.id}/images/${image.id}`}
                      unoptimized
                      width={320}
                    />
                  </a>
                ) : (
                  <Image
                    alt={image.caption || image.originalName}
                    height={220}
                    src={`/api/articles/${article.id}/images/${image.id}`}
                    unoptimized
                    width={320}
                  />
                )}
                {canEdit ? (
                  <label className="business-field">
                    <span>Caption</span>
                    <input defaultValue={image.caption} maxLength={500} name={`caption_${image.id}`} />
                  </label>
                ) : (
                  <p>{image.caption || image.originalName}</p>
                )}
                <small>
                  {image.originalName} · {(image.size / (1024 * 1024)).toFixed(1)} MB
                  {canViewImageDetail ? (
                    <> · <a className="text-link" href={`/articles/${article.id}/images/${image.id}`}>Details</a></>
                  ) : null}
                </small>
                {canEdit ? (
                  <label className="article-remove-image">
                    <input name="removeImageId" type="checkbox" value={image.id} />
                    Remove image
                  </label>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {canEdit ? (
        <section className="article-image-section">
          <h2>Add images</h2>
          <div className="business-form-grid">
            <div className="business-field business-field-wide">
              <span>Add image files</span>
              <ImageDropzone files={newFiles} hint="JPEG, PNG, or WebP · up to 10 MB per image · up to 50 MB per save" name="images" onChange={setNewFiles} />
            </div>
            <label className="business-field business-field-wide">
              <span>New image captions (one line per selected file, in file order)</span>
              <textarea name="newImageCaptions" placeholder="Leave blank to use no caption" rows={3} />
            </label>
          </div>
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
    </form>
  );
}
