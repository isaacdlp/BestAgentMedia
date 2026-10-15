"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

interface Creative {
  originalName: string;
  mimeType: string;
  size: number;
}

/**
 * The ad creative is not uploaded separately: it is one of the ad's image
 * resources, chosen with "Set as Creative" in the image resources table.
 */
export function AdCreativeSection({
  adId,
  initial,
  canEdit,
}: {
  adId: string;
  initial: Creative | null;
  canEdit: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  async function handleClear() {
    setError(null);
    const res = await fetch(`/api/ads/${adId}/creative`, { method: "DELETE" });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setError(data.error ?? "Could not clear the creative.");
      return;
    }
    startTransition(() => router.refresh());
  }

  return (
    <section className="panel">
      <div className="panel-heading">
        <h2>Ad creative</h2>
      </div>

      <div style={{ padding: "0 1.5rem 1.25rem" }}>
        {initial ? (
          <div className="ad-creative-preview">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              alt="Ad creative"
              className="ad-creative-img"
              key={`${initial.originalName}-${initial.size}`}
              src={`/api/ads/${adId}/creative?v=${initial.size}`}
            />
            <p className="muted" style={{ fontSize: "0.8125rem", marginTop: "0.5rem" }}>
              {initial.originalName} · {formatBytes(initial.size)}
            </p>
          </div>
        ) : (
          <div className="ad-creative-empty">
            <p className="muted" style={{ fontSize: "0.875rem", margin: 0 }}>
              {canEdit
                ? "No creative selected. Choose one of the image resources below with “Set as Creative”."
                : "No creative selected yet."}
            </p>
          </div>
        )}

        {error && <p className="ad-creative-error">{error}</p>}

        {canEdit && initial ? (
          <div className="ad-creative-actions">
            <button
              className="button button-small button-danger"
              disabled={isPending}
              onClick={handleClear}
              type="button"
            >
              Clear selection
            </button>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
