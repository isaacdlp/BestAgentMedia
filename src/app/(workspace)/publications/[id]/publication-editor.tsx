"use client";

import { useActionState } from "react";
import {
  updatePublication,
  type PublicationActionState,
} from "@/app/actions/publications";

type PublicationEditorProps = {
  coverImageUrl: string | null;
  id: number;
  name: string;
  slug: string;
  zipCodes: string[];
  submissionCount: number;
  advertisementCount: number;
};

const initialState: PublicationActionState = {};

export function PublicationEditor({
  coverImageUrl,
  id,
  name,
  slug,
  zipCodes,
  submissionCount,
  advertisementCount,
}: PublicationEditorProps) {
  const [actionState, formAction, pending] = useActionState(
    updatePublication,
    initialState,
  );

  return (
    <form action={formAction} className="business-form">
      <input name="id" type="hidden" defaultValue={id} />
      <div className="business-form-grid">
        <PublicationField label="Name" name="name" required value={name} />
        <PublicationField label="Slug" name="slug" required value={slug} />
        <label className="business-field business-field-wide">
          <span>ZIP codes (one per line)</span>
          <textarea
            defaultValue={zipCodes.join("\n")}
            name="zipCodes"
            required
            rows={4}
          />
        </label>
        <div className="business-field business-field-wide">
          <span>Publication cover</span>
          <div className="cover-image-editor">
            <div className="cover-image-actions">
              <label className="button button-secondary cover-upload-button">
                Upload new cover
                <input
                  accept="image/png,image/jpeg"
                  className="cover-image-input"
                  name="coverImage"
                  type="file"
                />
              </label>
              <small className="cover-image-hint">
                PNG or JPEG · at least 300 × 400 px · max 10 MB
              </small>
              {coverImageUrl ? (
                <label className="cover-remove-label">
                  <input name="removeCoverImage" type="checkbox" />
                  Remove current cover
                </label>
              ) : null}
            </div>
          </div>
        </div>
      </div>
      {actionState.error ? (
        <p aria-live="polite" className="form-error" role="alert">
          {actionState.error}
        </p>
      ) : null}
      <div className="publication-form-footer">
        <p className="muted">
          {submissionCount} submissions · {advertisementCount} advertisements
        </p>
        <button
          className="button button-primary business-save"
          disabled={pending}
          type="submit"
        >
          {pending ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function PublicationField({
  label,
  name,
  required = false,
  value,
}: {
  label: string;
  name: string;
  required?: boolean;
  value: string | null;
}) {
  return (
    <label className="business-field">
      <span>{label}</span>
      <input
        defaultValue={value ?? ""}
        name={name}
        required={required}
        type="text"
      />
    </label>
  );
}
