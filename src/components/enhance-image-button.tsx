"use client";

import { useEffect, useRef, useState } from "react";
import { AgentBadge } from "@/components/agent-badge";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";

type ImageType = "submission" | "article" | "business" | "ad" | "publication";

const SUGGESTIONS = [
  "Brighten and balance exposure",
  "Improve color and contrast",
  "Sharpen details",
  "Crop tighter on the subject",
  "Remove distracting background elements",
  "Remove watermark or text",
];

const MAX_LENGTH = 1000;

/**
 * Opens a short instructions dialog and launches an image enhancement Task. The dialog closes
 * as soon as the task starts; the result is reviewed on the task page.
 */
export function EnhanceImageButton({
  imageType,
  imageId,
  parentId,
  label = "Enhance",
}: {
  imageType: ImageType;
  imageId: string;
  parentId: string;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const [customInstructions, setCustomInstructions] = useState("");
  const [error, setError] = useState("");
  const [starting, setStarting] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    textareaRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !starting) {
        setOpen(false);
        setError("");
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, starting]);

  function addSuggestion(text: string) {
    setCustomInstructions((current) => {
      const trimmed = current.trim();
      if (trimmed.toLowerCase().includes(text.toLowerCase())) return current;
      const next = trimmed ? `${trimmed.replace(/[.;,]$/, "")}; ${text.toLowerCase()}` : text;
      return next.slice(0, MAX_LENGTH);
    });
    textareaRef.current?.focus();
  }

  function close() {
    setOpen(false);
    setError("");
  }

  async function handleEnhance() {
    setError("");
    setStarting(true);
    try {
      const res = await fetch("/api/creative/enhance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageType, imageId, parentId, customInstructions }),
      });
      const data = (await res.json()) as { task?: LaunchedTask; error?: string };
      if (!res.ok || !data.task) throw new Error(data.error ?? "Enhancement could not be started.");
      announceTaskStarted(data.task);
      setCustomInstructions("");
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Enhancement could not be started.");
    } finally {
      setStarting(false);
    }
  }

  if (!open) {
    return (
      <button className="button button-primary" type="button" onClick={() => setOpen(true)}>
        {label}
      </button>
    );
  }

  return (
    <div
      className="enhance-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Enhance image"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !starting) close();
      }}
    >
      <div className="enhance-modal">
        <div className="enhance-modal-header">
          <h2>Enhance image</h2>
          <button className="enhance-modal-close" type="button" aria-label="Close" onClick={close}>×</button>
        </div>

        <div className="enhance-modal-body">
          <AgentBadge agentSlug="creative" />
          <p className="enhance-intro">
            The Creative agent will improve the image&apos;s quality for print. Pick a few quick
            adjustments or describe exactly what you want.
          </p>

          <div className="enhance-chips" aria-label="Quick adjustments">
            {SUGGESTIONS.map((text) => (
              <button
                key={text}
                className="enhance-chip"
                type="button"
                disabled={starting}
                onClick={() => addSuggestion(text)}
              >
                + {text}
              </button>
            ))}
          </div>

          <label className="enhance-label">
            <span>
              Custom instructions <span className="muted">(optional)</span>
            </span>
            <textarea
              ref={textareaRef}
              className="enhance-textarea"
              rows={4}
              maxLength={MAX_LENGTH}
              placeholder={`e.g. "brighten the sky", "remove the watermark", "crop tighter on the subject"`}
              value={customInstructions}
              disabled={starting}
              onChange={(e) => setCustomInstructions(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !starting) {
                  e.preventDefault();
                  void handleEnhance();
                }
              }}
            />
            <span className="enhance-counter muted">
              {customInstructions.length}/{MAX_LENGTH} · Ctrl+Enter to start
            </span>
          </label>

          <p className="muted enhance-modal-hint">
            The Creative agent works in the background. You&apos;ll be notified when the result is ready
            to review in Tasks — the original stays untouched until you accept it.
          </p>

          {error ? <p className="form-error">{error}</p> : null}
        </div>

        <div className="enhance-modal-actions">
          <button className="button button-secondary" type="button" onClick={close}>
            Cancel
          </button>
          <button
            className="button button-primary"
            disabled={starting}
            type="button"
            onClick={() => void handleEnhance()}
          >
            {starting ? "Starting…" : "Start enhancement"}
          </button>
        </div>
      </div>
    </div>
  );
}
