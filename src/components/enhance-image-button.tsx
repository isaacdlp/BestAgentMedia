"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type ImageType = "submission" | "article" | "business" | "ad" | "publication";

type Phase = "idle" | "form" | "enhancing" | "result" | "applying";

export function EnhanceImageButton({
  imageType,
  imageId,
  parentId,
  originalImageSrc,
  agentPath,
  label = "Enhance",
}: {
  imageType: ImageType;
  imageId: string;
  parentId: string;
  /** URL of the original image, used for the side-by-side comparison */
  originalImageSrc: string;
  agentPath: string;
  label?: string;
}) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [customInstructions, setCustomInstructions] = useState("");
  const [error, setError] = useState("");
  const [taskId, setTaskId] = useState<string | null>(null);
  const [iterateFromTaskId, setIterateFromTaskId] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [applyError, setApplyError] = useState("");

  function openForm() {
    setError("");
    setApplyError("");
    setPhase("form");
  }

  function cancelForm() {
    setPhase("idle");
    setError("");
    setIterateFromTaskId(null);
  }

  async function handleEnhance() {
    setError("");
    setPhase("enhancing");
    try {
      const res = await fetch("/api/creative/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          imageType,
          imageId,
          parentId,
          customInstructions,
          ...(iterateFromTaskId ? { iterateFromTaskId } : {}),
        }),
      });
      const data = (await res.json()) as { taskId?: string; error?: string };
      if (!res.ok) throw new Error(data.error ?? "Enhancement failed.");
      setTaskId(data.taskId ?? null);
      setPhase("result");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enhancement failed.");
      setPhase("form");
    }
  }

  async function handleApply(action: "remove" | "overwrite" | "keep" | "iterate") {
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

  if (phase === "idle") {
    return (
      <button className="button button-secondary" type="button" onClick={openForm}>
        {label}
      </button>
    );
  }

  const isPublicationCover = imageType === "publication";

  return (
    <div className="enhance-overlay" role="dialog" aria-modal="true" aria-label="Enhance image">
      <div className="enhance-modal">
        {phase === "form" && (
          <>
            <div className="enhance-modal-header">
              <h2>Enhance image{iterateFromTaskId ? " — iteration" : ""}</h2>
              <button className="enhance-modal-close" type="button" aria-label="Close" onClick={cancelForm}>×</button>
            </div>

            {iterateFromTaskId ? (
              <p className="muted enhance-modal-hint">
                Using the previous enhanced image as the source for this pass.
              </p>
            ) : null}

            <label className="enhance-label">
              <span>
                Custom instructions{" "}
                <span className="muted">(optional)</span>
              </span>
              <textarea
                className="enhance-textarea"
                rows={3}
                placeholder={`Add your own notes — e.g. "brighten the sky", "remove the watermark", "crop tighter on the subject"…`}
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
                onClick={() => void handleEnhance()}
              >
                Enhance
              </button>
            </div>
          </>
        )}

        {phase === "enhancing" && (
          <div className="enhance-modal-loading">
            <div className="enhance-spinner" aria-hidden="true" />
            <p>Enhancing image…</p>
            <p className="muted">This may take 10–30 seconds.</p>
          </div>
        )}

        {(phase === "result" || phase === "applying") && taskId && (
          <>
            <div className="enhance-modal-header">
              <h2>Enhanced result</h2>
            </div>

            <div className="enhance-result-images">
              <div className="enhance-result-col">
                <p className="enhance-result-label muted">Original</p>
                <img
                  alt="Original image"
                  className="enhance-result-img"
                  src={originalImageSrc}
                />
              </div>
              <div className="enhance-result-col">
                <p className="enhance-result-label muted">Enhanced</p>
                <img
                  alt="Enhanced image"
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
                onClick={() => void handleApply("overwrite")}
              >
                {isPublicationCover ? "Replace cover" : "Overwrite original"}
              </button>
              {!isPublicationCover ? (
                <button
                  className="button button-secondary"
                  type="button"
                  disabled={applying}
                  onClick={() => void handleApply("keep")}
                >
                  Keep as new
                </button>
              ) : null}
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
              <strong>{isPublicationCover ? "Replace cover" : "Overwrite original"}</strong> replaces
              the original in place.
              {!isPublicationCover ? (
                <>
                  {" "}
                  <strong>Keep as new</strong> saves the enhanced version alongside the original.
                </>
              ) : null}{" "}
              <strong>Iterate</strong> uses this result as the source for another enhancement pass.
            </p>

            <div className="enhance-result-agent-link">
              <a className="text-link" href={agentPath}>
                View in Creative agent →
              </a>
            </div>
          </>
        )}

        {phase === "applying" && (
          <div className="enhance-applying-overlay">
            <div className="enhance-spinner" aria-hidden="true" />
            <p>Applying…</p>
          </div>
        )}
      </div>
    </div>
  );
}
