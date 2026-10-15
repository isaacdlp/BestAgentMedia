"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { ImageDropzone } from "@/components/image-dropzone";

type SubmissionImage = {
  id: string;
  originalName: string;
  size: number;
};

type PublicationOption = {
  id: number;
  name: string;
};

type BusinessOption = {
  id: number;
  name: string;
};

type SubmissionEditorProps = {
  canChangePublication: boolean;
  canManageStatus: boolean;
  images: SubmissionImage[];
  initialValues: {
    id: string;
    title: string;
    body: string;
    storyType: string;
    postalCode: string;
    publicationId: number;
    submitterName: string;
    submitterEmail: string;
    submitterPhone: string;
    status: string;
    businessId: number | null;
  };
  publications: PublicationOption[];
  businesses: BusinessOption[];
};

const storyTypes = [
  ["community", "Community spotlight"],
  ["family", "People and families"],
  ["event", "Local event"],
  ["organization", "Community organization"],
  ["pet", "Pets"],
  ["sports", "Local sports"],
  ["announcement", "Community announcement"],
  ["other", "Other story"],
];

export function SubmissionEditor({
  canChangePublication,
  canManageStatus,
  images,
  initialValues,
  publications,
  businesses,
}: SubmissionEditorProps) {
  const router = useRouter();
  const [existingImages, setExistingImages] = useState(images);
  const [newImages, setNewImages] = useState<File[]>([]);
  const [removedImageIds, setRemovedImageIds] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const visibleImages = existingImages.filter(
    (image) => !removedImageIds.includes(image.id),
  );

  function selectImages(files: File[]) {
    setNewImages(files);
    setError(null);
    setNotice(null);
  }

  async function saveSubmission(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSaving(true);
    const formData = new FormData(event.currentTarget);
    newImages.forEach((image) => formData.append("images", image));
    removedImageIds.forEach((imageId) =>
      formData.append("removeImageId", imageId),
    );

    try {
      const response = await fetch(`/api/submissions/${initialValues.id}`, {
        method: "PATCH",
        body: formData,
      });
      const result = (await response.json()) as {
        message?: string;
        error?: string;
        images?: SubmissionImage[];
      };
      if (!response.ok || !result.message || !result.images) {
        throw new Error(result.error ?? "Unable to save submission changes.");
      }
      setNotice(result.message);
      setExistingImages(result.images);
      setNewImages([]);
      setRemovedImageIds([]);
      router.refresh();
    } catch (saveError) {
      console.error("Submission update failed:", saveError);
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Unable to save submission changes. Please try again.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="business-form" onSubmit={saveSubmission}>
      <div className="business-form-grid">
        <label className="business-field">
          <span>Story title *</span>
          <input
            defaultValue={initialValues.title}
            maxLength={200}
            name="title"
            required
          />
        </label>
        <label className="business-field">
          <span>Story category *</span>
          <select
            defaultValue={initialValues.storyType}
            name="storyType"
            required
          >
            {storyTypes.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </label>
        <label className="business-field business-field-wide">
          <span>Story details *</span>
          <textarea
            defaultValue={initialValues.body}
            maxLength={20_000}
            name="body"
            required
            rows={8}
          />
        </label>
        <label className="business-field">
          <span>ZIP code *</span>
          <input
            defaultValue={initialValues.postalCode}
            inputMode="numeric"
            maxLength={5}
            name="postalCode"
            pattern="\d{5}"
            required
          />
        </label>
        <label className="business-field">
          <span>Publication *</span>
          {canChangePublication ? (
            <select
              defaultValue={initialValues.publicationId}
              name="publicationId"
              required
            >
              {publications.map((publication) => (
                <option key={publication.id} value={publication.id}>
                  {publication.name}
                </option>
              ))}
            </select>
          ) : (
            <>
              <span className="submission-readonly-value">
                {publications[0]?.name ?? "Unavailable"}
              </span>
              <input
                defaultValue={initialValues.publicationId}
                name="publicationId"
                type="hidden"
              />
            </>
          )}
        </label>
        <label className="business-field">
          <span>Submitter name *</span>
          <input
            defaultValue={initialValues.submitterName}
            maxLength={201}
            name="submitterName"
            required
          />
        </label>
        <label className="business-field">
          <span>Submitter email *</span>
          <input
            defaultValue={initialValues.submitterEmail}
            maxLength={320}
            name="submitterEmail"
            required
            type="email"
          />
        </label>
        <label className="business-field">
          <span>Submitter phone</span>
          <input
            defaultValue={initialValues.submitterPhone}
            maxLength={50}
            name="submitterPhone"
            type="tel"
          />
        </label>
        {canManageStatus ? (
          <label className="business-field">
            <span>Review status</span>
            <select defaultValue={initialValues.status} name="status">
              <option value="NEW">New</option>
              <option value="IN_REVIEW">In review</option>
              <option value="NEEDS_INFORMATION">Needs information</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="DECLINED">Declined</option>
            </select>
          </label>
        ) : null}
        {canManageStatus && businesses.length > 0 ? (
          <label className="business-field">
            <span>Associated business</span>
            <select defaultValue={initialValues.businessId ?? ""} name="businessId">
              <option value="">None</option>
              {businesses.map((business) => (
                <option key={business.id} value={business.id}>{business.name}</option>
              ))}
            </select>
          </label>
        ) : null}
        <div className="business-field business-field-wide">
          <span>Story images</span>
          <p className="muted">
            Upload up to five JPEG, PNG, or WebP images, maximum 10 MB each.
          </p>
          <ImageDropzone
            files={newImages}
            maxFiles={Math.max(0, 5 - visibleImages.length)}
            onChange={selectImages}
            showList={false}
          />
          {visibleImages.length || newImages.length ? (
            <ul className="submission-image-grid">
              {visibleImages.map((image) => (
                <li key={image.id}>
                  <Link
                    aria-label={`View image details for ${image.originalName}`}
                    className="submission-image-thumbnail-link"
                    href={`/submissions/${initialValues.id}/images/${image.id}`}
                  >
                    <Image
                      alt={image.originalName}
                      height={180}
                      src={`/api/submissions/${initialValues.id}/images/${image.id}`}
                      unoptimized
                      width={240}
                    />
                  </Link>
                  <span>{image.originalName} ({formatFileSize(image.size)})</span>
                  <button
                    className="text-link"
                    onClick={() => {
                      setRemovedImageIds((current) => [...current, image.id]);
                      setError(null);
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </li>
              ))}
              {newImages.map((image, index) => (
                <li key={`${image.name}-${image.lastModified}-${index}`}>
                  <span>{image.name} ({formatFileSize(image.size)}) · New</span>
                  <button
                    className="text-link"
                    onClick={() => {
                      setNewImages((current) =>
                        current.filter((_, fileIndex) => fileIndex !== index),
                      );
                      setError(null);
                    }}
                    type="button"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="muted">No images attached.</p>
          )}
        </div>
      </div>
      {error ? <p aria-live="polite" className="form-error" role="alert">{error}</p> : null}
      {notice ? <p aria-live="polite" className="submission-save-notice" role="status">{notice}</p> : null}
      <div className="submission-editor-footer">
        <p className="muted">{visibleImages.length + newImages.length} of 5 images</p>
        <button className="button button-primary" disabled={saving} type="submit">
          {saving ? "Saving…" : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function formatFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
