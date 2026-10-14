"use client";

import { useTaskLauncher } from "@/components/use-task-launcher";

/** Launches a Task that imports up to 5 photos from Google Places; the new images appear once it finishes. */
export function ImportImagesButton({ businessId }: { businessId: number }) {
  const { launch, starting, error } = useTaskLauncher();

  return (
    <div className="import-images-action">
      <button
        className="button button-primary"
        disabled={starting}
        onClick={() => void launch(`/api/businesses/${businessId}/images/import`)}
        title="Imports up to 5 photos from Google Places as a background task"
        type="button"
      >
        {starting ? "Starting…" : "Import Images"}
      </button>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
  );
}
