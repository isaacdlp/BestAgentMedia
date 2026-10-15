"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentBadge } from "@/components/agent-badge";
import { useTaskLauncher } from "@/components/use-task-launcher";

const MAX_INSTRUCTIONS = 2000;

const INSTRUCTION_SUGGESTIONS = [
  "Keep the emails short",
  "Use a formal tone",
  "Focus on getting the ad approved first",
];

/**
 * Opens the Marketer's options and launches a Task that emails the ad or article to its advertiser
 * for review and offers a paid promotion package for the issue. The conversation then continues in
 * the background; the dialog closes as soon as the task starts.
 */
export function SubmitReviewButton({
  apiPath,
  disabled = false,
}: {
  apiPath: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const { launch, starting, error } = useTaskLauncher();
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");

  async function handleStart() {
    if (await launch(apiPath, { instructions })) {
      setInstructions("");
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button className="button button-primary" disabled={disabled} onClick={() => setOpen(true)} type="button">
        Submit for Review
      </button>
      {open ? (
        <div className="enhance-overlay" role="dialog" aria-modal="true" aria-label="Submit for review">
          <div className="enhance-modal">
            <div className="enhance-modal-header">
              <h2>Submit for review</h2>
              <button className="enhance-modal-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="enhance-modal-body">
              <AgentBadge agentSlug="marketer" />
              <label className="enhance-label">
                <span>
                  Custom instructions <span className="muted">(optional)</span>
                </span>
                <textarea
                  className="enhance-textarea"
                  maxLength={MAX_INSTRUCTIONS}
                  onChange={(e) => setInstructions(e.target.value)}
                  placeholder="Anything the Marketer should know or do in this conversation…"
                  rows={4}
                  value={instructions}
                />
                <span className="muted enhance-counter">
                  {instructions.length}/{MAX_INSTRUCTIONS}
                </span>
              </label>
              <div className="enhance-chips" aria-label="Quick suggestions">
                {INSTRUCTION_SUGGESTIONS.map((text) => (
                  <button
                    className="enhance-chip"
                    key={text}
                    onClick={() => setInstructions((prev) => (prev.trim() ? `${prev.trim()}. ${text}` : text))}
                    type="button"
                  >
                    + {text}
                  </button>
                ))}
              </div>

              {error ? <p className="form-error">{error}</p> : null}
            </div>

            <div className="enhance-modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={starting} onClick={() => void handleStart()} type="button">
                {starting ? "Starting…" : "Start review"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
