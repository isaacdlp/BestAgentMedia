"use client";

import { useTaskLauncher } from "@/components/use-task-launcher";

/** Launches a Copywriter editorial review Task. */
export function ReviewButton({ apiPath }: { apiPath: string }) {
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
        {starting ? "Starting…" : "Review"}
      </button>
    </div>
  );
}
