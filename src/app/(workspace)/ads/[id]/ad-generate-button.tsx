"use client";

import { useState } from "react";
import { AgentBadge } from "@/components/agent-badge";
import { describePrintSize, resolveAdPrintSize, type ResolvedAdPrintSpec } from "@/lib/ad-print-specs";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";

const STYLE_SUGGESTIONS = [
  "Bold headline",
  "Dark background",
  "Use the logo prominently",
  "Clean and minimal",
  "Warm, local feel",
];

const PRINT_SIZE_SOURCES: Record<ResolvedAdPrintSpec["source"], string> = {
  instructions: "from your instructions",
  previous: "same as the version being revised",
  style: "from the ad's style",
  default: "default — the ad's style names no size",
};

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
  styleName,
  styleDescription,
  reviewCount,
}: {
  adId: string;
  images: AdImage[];
  agentEnabled: boolean;
  /** The ad's style (rate) name and description; the printed size comes from them. */
  styleName: string | null;
  styleDescription: string | null;
  /** Advertiser reviews on the ad (Reviews tab), offered to the Creative. */
  reviewCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [includeReviews, setIncludeReviews] = useState(true);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(images.map((img) => img.id)),
  );
  const [customInstructions, setCustomInstructions] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);
  const printSize = resolveAdPrintSize({ customInstructions, styleName, styleDescription });

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
        body: JSON.stringify({ adId, imageIds: Array.from(selectedIds), customInstructions, includeReviews }),
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
      <button className="button button-primary" type="button" disabled title="Creative agent is disabled">
        Generate
      </button>
    );
  }

  if (images.length === 0) {
    return (
      <button className="button button-primary" type="button" disabled title="Upload at least one image first">
        Generate
      </button>
    );
  }

  if (!open) {
    return (
      <button className="button button-primary" type="button" onClick={openForm}>
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

        <div className="enhance-modal-body adgen-body">
          <AgentBadge agentSlug="creative" />
          <p className="enhance-intro">
            The Creative agent designs a print ad from the reference images you pick, your notes, and the ad,
            business, publication, and issue details. Nothing is added to this ad until you review and save the result.
          </p>
          <p className="muted enhance-modal-hint">
            Printed size ({PRINT_SIZE_SOURCES[printSize.source]}): <strong>{describePrintSize(printSize.spec)}</strong>.
            Name another size (for example &quot;quarter page&quot;) or exact inches (&quot;5 x 7 in&quot;) in the
            custom instructions to override it.
          </p>

          <section className="adgen-section">
            <div className="adgen-section-head">
              <h3>
                Reference images{" "}
                <span className="count-badge">
                  {selectedIds.size} of {images.length}
                </span>
              </h3>
              <div className="adgen-section-actions">
                <button className="text-link" type="button" onClick={() => setSelectedIds(new Set(images.map((img) => img.id)))}>
                  Select all
                </button>
                <button className="text-link" type="button" onClick={() => setSelectedIds(new Set())}>
                  None
                </button>
              </div>
            </div>
            <div className="adgen-images">
              {images.map((img) => {
                const checked = selectedIds.has(img.id);
                return (
                  <label className={`adgen-image${checked ? " adgen-image-selected" : ""}`} key={img.id} title={img.originalName}>
                    <input checked={checked} onChange={() => toggleImage(img.id)} type="checkbox" />
                    <img alt={img.originalName} src={`/api/ads/${adId}/images/${img.id}`} />
                    <span className="adgen-image-check" aria-hidden="true">✓</span>
                    <span className="adgen-image-name">{img.originalName}</span>
                  </label>
                );
              })}
            </div>
            {selectedIds.size === 0 ? (
              <p className="adgen-warning">Select at least one image to continue.</p>
            ) : null}
          </section>

          <section className="adgen-section">
            <label className="enhance-label">
              <span>
                Custom instructions <span className="muted">(optional)</span>
              </span>
              <textarea
                className="enhance-textarea"
                maxLength={1000}
                onChange={(e) => setCustomInstructions(e.target.value)}
                placeholder="Describe what you want…"
                rows={3}
                value={customInstructions}
              />
            </label>
            <div className="enhance-chips" aria-label="Quick suggestions">
              {STYLE_SUGGESTIONS.map((text) => (
                <button
                  className="enhance-chip"
                  key={text}
                  onClick={() =>
                    setCustomInstructions((prev) => (prev.trim() ? `${prev.trim()}. ${text}` : text))
                  }
                  type="button"
                >
                  + {text}
                </button>
              ))}
            </div>
          </section>

          {reviewCount > 0 ? (
            <label className="adgen-reviews-toggle">
              <input checked={includeReviews} onChange={(e) => setIncludeReviews(e.target.checked)} type="checkbox" />
              <span>
                Give the Creative the advertiser&apos;s {reviewCount} review{reviewCount === 1 ? "" : "s"} (Reviews tab), so
                requested changes are applied
              </span>
            </label>
          ) : null}

          <p className="muted enhance-modal-hint">
            The agent works in the background. You&apos;ll be notified in Tasks when the ad is ready to review.
          </p>

          {error ? <p className="form-error">{error}</p> : null}
        </div>

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
