"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

export function BusinessImagesForm({ businessId }: { businessId: number }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = fileRef.current?.files;
    if (!files || files.length === 0) {
      setError("Select at least one image.");
      return;
    }
    setError(null);
    const formData = new FormData();
    for (const file of files) {
      formData.append("images", file);
    }
    startTransition(async () => {
      try {
        const res = await fetch(`/api/businesses/${businessId}/images`, { method: "POST", body: formData });
        if (!res.ok) {
          const data = await res.json().catch(() => ({}));
          setError((data as { error?: string }).error ?? "Upload failed.");
          return;
        }
        if (fileRef.current) fileRef.current.value = "";
        router.refresh();
      } catch {
        setError("Upload failed. Please try again.");
      }
    });
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "flex", gap: "0.75rem", alignItems: "flex-start", flexWrap: "wrap" }}>
        <input
          ref={fileRef}
          accept="image/jpeg,image/png,image/webp"
          multiple
          name="images"
          type="file"
          style={{ flex: 1, minWidth: 0 }}
        />
        <button className="button" disabled={isPending} type="submit">
          {isPending ? "Uploading…" : "Upload images"}
        </button>
      </div>
      {error ? <p style={{ color: "var(--color-error, red)", marginTop: "0.5rem", fontSize: "0.875rem" }}>{error}</p> : null}
      <p className="muted" style={{ marginTop: "0.375rem", fontSize: "0.75rem" }}>
        JPEG, PNG or WebP · max 10 MB each
      </p>
    </form>
  );
}
