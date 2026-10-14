"use client";

import { useTaskLauncher } from "@/components/use-task-launcher";

/** Launches an Assistant Task that drafts a clarification email for review (nothing is sent). */
export function RequestInfoButton({ apiPath }: { apiPath: string }) {
  const { launch, starting, error } = useTaskLauncher();

  return (
    <div className="review-button-wrap">
      {error ? <p className="form-error review-button-error">{error}</p> : null}
      <button
        className="button button-secondary"
        disabled={starting}
        onClick={() => void launch(apiPath)}
        type="button"
      >
        {starting ? "Starting…" : "Request Info"}
      </button>
    </div>
  );
}
