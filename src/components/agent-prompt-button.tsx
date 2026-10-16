"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AgentBadge } from "@/components/agent-badge";
import { useTaskLauncher } from "@/components/use-task-launcher";

const MAX_INSTRUCTIONS = 2000;
const MIN_PAGES = 0.25;
const MAX_PAGES = 6;

/**
 * Button that opens a dialog for optional custom instructions to an agent, then launches the
 * agent's Task at `apiPath` with `{ ...body, instructions }`. The dialog closes as soon as the
 * task starts; progress continues in the Tasks section.
 */
export function AgentPromptButton({
  agentSlug,
  apiPath,
  body = {},
  buttonLabel,
  description,
  dialogTitle,
  placeholder,
  startLabel,
  suggestions = [],
  variant = "secondary",
  pageLength,
}: {
  agentSlug: string;
  apiPath: string;
  body?: Record<string, unknown>;
  buttonLabel: string;
  description?: string;
  dialogTitle: string;
  placeholder: string;
  startLabel: string;
  suggestions?: string[];
  variant?: "primary" | "secondary";
  /** Adds a target length in magazine pages, sent as `targetPages`. */
  pageLength?: { defaultPages: number; wordsPerPage: number };
}) {
  const router = useRouter();
  const { launch, starting, error } = useTaskLauncher();
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState("");
  const [pages, setPages] = useState(String(pageLength?.defaultPages ?? 1));
  const pageCount = Number(pages);
  const pagesValid = !pageLength || (Number.isFinite(pageCount) && pageCount >= MIN_PAGES && pageCount <= MAX_PAGES);

  async function handleStart() {
    if (!pagesValid) return;
    if (await launch(apiPath, { ...body, instructions, ...(pageLength ? { targetPages: pageCount } : {}) })) {
      setInstructions("");
      setOpen(false);
      router.refresh();
    }
  }

  return (
    <>
      <button className={`button button-${variant}`} onClick={() => setOpen(true)} type="button">
        {buttonLabel}
      </button>
      {open ? (
        <div className="enhance-overlay" role="dialog" aria-modal="true" aria-label={dialogTitle}>
          <div className="enhance-modal">
            <div className="enhance-modal-header">
              <h2>{dialogTitle}</h2>
              <button className="enhance-modal-close" type="button" aria-label="Close" onClick={() => setOpen(false)}>×</button>
            </div>

            <div className="enhance-modal-body">
              <AgentBadge agentSlug={agentSlug} />
              {description ? <p className="muted">{description}</p> : null}
              {pageLength ? (
                <label className="enhance-label">
                  <span>Target length (pages)</span>
                  <input
                    className="enhance-pages-input"
                    max={MAX_PAGES}
                    min={MIN_PAGES}
                    onChange={(e) => setPages(e.target.value)}
                    step={0.25}
                    type="number"
                    value={pages}
                  />
                  <span className="muted enhance-counter">
                    {pagesValid
                      ? `About ${Math.round(pageCount * pageLength.wordsPerPage)} words (${pageLength.wordsPerPage} per page)`
                      : `Enter between ${MIN_PAGES} and ${MAX_PAGES} pages`}
                  </span>
                </label>
              ) : null}
              <label className="enhance-label">
                <span>
                  Custom instructions <span className="muted">(optional)</span>
                </span>
                <textarea
                  autoFocus
                  className="enhance-textarea"
                  maxLength={MAX_INSTRUCTIONS}
                  onChange={(e) => setInstructions(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !starting) void handleStart();
                  }}
                  placeholder={placeholder}
                  rows={4}
                  value={instructions}
                />
                <span className="muted enhance-counter">
                  {instructions.length}/{MAX_INSTRUCTIONS} · Ctrl+Enter to start
                </span>
              </label>
              {suggestions.length ? (
                <div className="enhance-chips" aria-label="Quick suggestions">
                  {suggestions.map((text) => (
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
              ) : null}

              {error ? <p className="form-error">{error}</p> : null}
            </div>

            <div className="enhance-modal-actions">
              <button className="button button-secondary" type="button" onClick={() => setOpen(false)}>
                Cancel
              </button>
              <button className="button button-primary" disabled={starting || !pagesValid} onClick={() => void handleStart()} type="button">
                {starting ? "Starting…" : startLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
