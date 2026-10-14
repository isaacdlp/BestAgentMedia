"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Creative {
  originalName: string;
  mimeType: string;
  size: number;
}

export function AdCreativeSection({
  adId,
  initial,
  canEdit,
}: {
  adId: string;
  initial: Creative | null;
  canEdit: boolean;
}) {
  const [creative, setCreative] = useState<Creative | null>(initial);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const imgSrc = `/api/ads/${adId}/creative`;

  async function handleUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("creative", file);
      const res = await fetch(`/api/ads/${adId}/creative`, { method: "POST", body: fd });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? "Upload failed.");
      }
      setCreative({ originalName: file.name, mimeType: file.type, size: file.size });
      startTransition(() => router.refresh());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleRemove() {
    setError(null);
    const res = await fetch(`/api/ads/${adId}/creative`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Remove failed.");
      return;
    }
    setCreative(null);
    startTransition(() => router.refresh());
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Ad creative</h2>
      </div>

      <div style={{ padding: "0 1.5rem 1.25rem" }}>
        {creative ? (
          <div className="ad-creative-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              key={creative.originalName}
              src={`${imgSrc}?t=${Date.now()}`}
              alt="Ad creative"
              className="ad-creative-img"
            />
            <p className="muted" style={{ fontSize: "0.8125rem", marginTop: "0.5rem" }}>
              {creative.originalName} · {formatBytes(creative.size)}
            </p>
          </div>
        ) : (
          <div className="ad-creative-empty">
            <p className="muted" style={{ fontSize: "0.875rem", margin: 0 }}>
              No creative uploaded yet.
            </p>
          </div>
        )}

        {error && (
          <p className="ad-creative-error">{error}</p>
        )}

        {canEdit && (
          <div className="ad-creative-actions">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              style={{ display: "none" }}
              onChange={handleUpload}
            />
            <button
              type="button"
              className="button button-small"
              disabled={uploading || isPending}
              onClick={() => fileInputRef.current?.click()}
            >
              {uploading ? "Uploading…" : creative ? "Replace" : "Upload"}
            </button>
            {creative && (
              <button
                type="button"
                className="button button-small button-danger"
                disabled={uploading || isPending}
                onClick={handleRemove}
              >
                Remove
              </button>
            )}
          </div>
        )}
      </div>
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
