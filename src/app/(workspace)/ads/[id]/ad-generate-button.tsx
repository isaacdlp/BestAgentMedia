"use client";

import { useState } from "react";
import { AgentBadge } from "@/components/agent-badge";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";

interface AdImage {
  id: string;
  originalName: string;
}

/**
 * Opens the ad generation options and launches a Creative Task. The dialog closes as soon as
 * the task starts; the generated ad is reviewed on the task page.
 */
export function AdGenerateButton({
  adId,
  images,
  agentEnabled,
}: {
  adId: string;
  images: AdImage[];
  agentEnabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(images.map((img) => img.id)),
  );
  const [customInstructions, setCustomInstructions] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  function openForm() {
    setError("");
    setSelectedIds(new Set(images.map((img) => img.id)));
    setOpen(true);
  }

  function toggleImage(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleGenerate() {
    if (selectedIds.size === 0) {
      setError("Select at least one image to use as reference.");
      return;
    }
    setError("");
    setStarting(true);
    try {
      const res = await fetch("/api/creative/generate-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ adId, imageIds: Array.from(selectedIds), customInstructions }),
      });
      const data = (await res.json()) as { task?: LaunchedTask; error?: string };
      if (!res.ok || !data.task) throw new Error(data.error ?? "Ad generation could not be started.");
      announceTaskStarted(data.task);
      setCustomInstructions("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Ad generation could not be started.");
    } finally {
      setStarting(false);
    }
  }

  if (!agentEnabled) {
    return (
      <button className="button button-small" type="button" disabled title="Creative agent is disabled">
        Generate
      </button>
    );
  }

  if (images.length === 0) {
    return (
      <button className="button button-small" type="button" disabled title="Upload at least one image first">
        Generate
      </button>
    );
  }

  if (!open) {
    return (
      <button className="button button-small" type="button" onClick={openForm}>
        Generate
      </button>
    );
  }

  return (
    <div className="enhance-overlay" role="dialog" aria-modal="true" aria-label="Generate ad">
      <div className="enhance-modal">
        <div className="enhance-modal-header">
          <h2>Generate ad</h2>
          <button className="enhance-modal-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
        </div>

        <AgentBadge agentSlug="creative" />

        <div style={{ padding: "0 0 1rem" }}>
          <p style={{ fontSize: "0.875rem", fontWeight: 500, marginBottom: "0.5rem" }}>
            Reference images{" "}
            <span className="muted" style={{ fontWeight: 400 }}>
              (select which to include)
            </span>
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "0.375rem" }}>
            {images.map((img) => (
              <label key={img.id} style={{ display: "flex", alignItems: "center", gap: "0.5rem", cursor: "pointer", fontSize: "0.875rem" }}>
                <img
                  src={`/api/ads/${adId}/images/${img.id}`}
                  alt={img.originalName}
                  style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 3, flexShrink: 0 }}
                />
                <input
                  type="checkbox"
                  checked={selectedIds.has(img.id)}
                  onChange={() => toggleImage(img.id)}
                  style={{ flexShrink: 0 }}
                />
                <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                  {img.originalName}
                </span>
              </label>
            ))}
          </div>
          {selectedIds.size === 0 && (
            <p style={{ color: "var(--color-danger, #c0392b)", fontSize: "0.8125rem", marginTop: "0.375rem" }}>
              Select at least one image.
            </p>
          )}
        </div>

        <label className="enhance-label">
          <span>
            Custom instructions{" "}
            <span className="muted">(optional)</span>
          </span>
          <textarea
            className="enhance-textarea"
            rows={3}
            placeholder={`Describe the style or layout — e.g. "bold headline with dark background", "use the logo prominently"…`}
            value={customInstructions}
            onChange={(e) => setCustomInstructions(e.target.value)}
          />
        </label>

        <p className="muted enhance-modal-hint">
          The Creative agent works in the background. You&apos;ll be notified when the ad is ready to
          review in Tasks — nothing is added to this ad until you save it.
        </p>

        {error ? <p className="form-error">{error}</p> : null}

        <div className="enhance-modal-actions">
          <button className="button button-secondary" type="button" onClick={() => setOpen(false)}>
            Cancel
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={selectedIds.size === 0 || starting}
            onClick={() => void handleGenerate()}
          >
            {starting ? "Starting…" : "Start generation"}
          </button>
        </div>
      </div>
    </div>
  );
}
