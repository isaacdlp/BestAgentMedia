"use client";

import { useTaskLauncher } from "@/components/use-task-launcher";

/** Launches a Marketer Task that drafts a sponsored-article pitch email for review (nothing is sent). */
export function PitchButton({ businessId }: { businessId: number }) {
  const { launch, starting, error } = useTaskLauncher();

  return (
    <div className="pitch-button-wrap">
      {error ? <p className="form-error pitch-button-error">{error}</p> : null}
      <button
        className="button button-secondary"
        disabled={starting}
        onClick={() => void launch(`/api/businesses/${businessId}/pitch`, { pitchType: "sponsored_article" })}
        type="button"
      >
        {starting ? "Starting…" : "Promote"}
      </button>
    </div>
  );
}
