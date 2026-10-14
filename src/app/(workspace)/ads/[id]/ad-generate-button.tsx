"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type Phase = "idle" | "form" | "generating" | "result" | "applying";

interface AdImage {
  id: string;
  originalName: string;
}

export function AdGenerateButton({
  adId,
  images,
  agentEnabled,
}: {
  adId: string;
  images: AdImage[];
  agentEnabled: boolean;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(
    () => new Set(images.map((img) => img.id)),
  );
  const [customInstructions, setCustomInstructions] = useState("");
  const [error, setError] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [iterateFromTaskId, setIterateFromTaskId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");

  function openForm() {
    setError("");
    setApplyError("");
    setSelectedIds(new Set(images.map((img) => img.id)));
    setPhase("form");
  }

  function cancelForm() {
    setPhase("idle");
    setError("");
    setIterateFromTaskId(null);
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
    setPhase("generating");
    try {
      const body: Record<string, unknown> = {
        adId,
        imageIds: Array.from(selectedIds),
        customInstructions,
      };
      if (iterateFromTaskId) body.iterateFromTaskId = iterateFromTaskId;

      const res = await fetch("/api/creative/generate-ad", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Generation failed.");
      setTaskId(data.taskId ?? null);
      setPhase("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Generation failed.");
      setPhase("form");
    }
  }

  async function handleApply(action: "remove" | "keep" | "iterate") {
    if (!taskId) return;
    setApplyError("");

    if (action === "iterate") {
      setIterateFromTaskId(taskId);
      setTaskId(null);
      setCustomInstructions("");
      setPhase("form");
      return;
    }

    setApplying(true);
    setPhase("applying");
    try {
      const res = await fetch(`/api/creative/tasks/${taskId}/apply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const data = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Action failed.");
      router.refresh();
      setPhase("idle");
      setTaskId(null);
      setCustomInstructions("");
      setIterateFromTaskId(null);
    } catch (err) {
      setApplyError(err instanceof Error ? err.message : "Action failed.");
      setPhase("result");
    } finally {
      setApplying(false);
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

  if (phase === "idle") {
    return (
      <button className="button button-small" type="button" onClick={openForm}>
        Generate
      </button>
    );
  }

  return (
    <div className="enhance-overlay" role="dialog" aria-modal="true" aria-label="Generate ad">
      <div className="enhance-modal">
        {phase === "form" && (
          <>
            <div className="enhance-modal-header">
              <h2>Generate ad{iterateFromTaskId ? " — iterate" : ""}</h2>
              <button className="enhance-modal-close" type="button" aria-label="Close" onClick={cancelForm}>×</button>
            </div>

            {iterateFromTaskId ? (
              <p className="muted enhance-modal-hint">
                Using the previous generated image as the source for this pass.
              </p>
            ) : null}

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
                    {/* eslint-disable-next-line @next/next/no-img-element */}
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

            {error ? <p className="form-error">{error}</p> : null}

            <div className="enhance-modal-actions">
              <button className="button button-secondary" type="button" onClick={cancelForm}>
                Cancel
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={selectedIds.size === 0}
                onClick={() => void handleGenerate()}
              >
                Generate
              </button>
            </div>
          </>
        )}

        {phase === "generating" && (
          <div className="enhance-modal-loading">
            <div className="enhance-spinner" aria-hidden="true" />
            <p>Generating ad…</p>
            <p className="muted">This may take 15–45 seconds.</p>
          </div>
        )}

        {(phase === "result" || phase === "applying") && taskId && (
          <>
            <div className="enhance-modal-header">
              <h2>Generated ad</h2>
            </div>

            <div className="enhance-result-images" style={{ gridTemplateColumns: "1fr" }}>
              <div className="enhance-result-col">
                <p className="enhance-result-label muted">Generated</p>
                <img
                  alt="Generated ad"
                  className="enhance-result-img enhance-result-img-new"
                  src={`/api/creative/tasks/${taskId}/image`}
                />
              </div>
            </div>

            {applyError ? <p className="form-error">{applyError}</p> : null}

            <div className="enhance-result-actions">
              <button
                className="button button-secondary button-danger"
                type="button"
                disabled={applying}
                onClick={() => void handleApply("remove")}
              >
                Remove
              </button>
              <button
                className="button button-secondary"
                type="button"
                disabled={applying}
                onClick={() => void handleApply("keep")}
              >
                Save as Image
              </button>
              <button
                className="button button-primary"
                type="button"
                disabled={applying}
                onClick={() => void handleApply("iterate")}
              >
                Iterate
              </button>
            </div>

            <p className="enhance-result-hint muted">
              <strong>Remove</strong> discards the result.{" "}
              <strong>Save as Image</strong> adds it to this ad's image resources.{" "}
              <strong>Iterate</strong> uses this result as the source for another generation pass.
            </p>
          </>
        )}

        {phase === "applying" && (
          <div className="enhance-applying-overlay">
            <div className="enhance-spinner" aria-hidden="true" />
            <p>Saving…</p>
          </div>
        )}
      </div>
    </div>
  );
}
