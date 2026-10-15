"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ImageDropzone } from "@/components/image-dropzone";

export function AdImagesForm({ adId }: { adId: string }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (files.length === 0) {
      setError("Select at least one image.");
      return;
    }
    setError(null);
    const formData = new FormData();
    for (const file of files) formData.append("images", file);
    startTransition(async () => {
      try {
        const res = await fetch(`/api/ads/${adId}/images`, { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { error?: string }).error ?? "Upload failed.");
          return;
        }
        setFiles([]);
        router.refresh();
      } catch {
        setError("Upload failed. Please try again.");
      }
    });
  }

  return (
    <form className="dropzone dropzone-form" onSubmit={handleSubmit}>
      <ImageDropzone disabled={isPending} files={files} onChange={setFiles} />
      {error ? <p className="dropzone-error" role="alert">{error}</p> : null}
      {files.length ? (
        <div className="dropzone-actions">
          <button className="button button-primary" disabled={isPending} type="submit">
            {isPending ? "Uploading…" : `Upload ${files.length} image${files.length === 1 ? "" : "s"}`}
          </button>
        </div>
      ) : null}
    </form>
  );
}
