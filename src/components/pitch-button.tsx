"use client";

import { useState } from "react";
import { useTaskLauncher } from "@/components/use-task-launcher";

type PitchType = "sponsored_article" | "advertisement";

/** Launches a Marketer Task that drafts a pitch email for review (nothing is sent). */
export function PitchButton({ businessId }: { businessId: number }) {
  const [pitchType, setPitchType] = useState<PitchType>("sponsored_article");
  const { launch, starting, error } = useTaskLauncher();

  return (
    <div className="pitch-button-wrap">
      {error ? <p className="form-error pitch-button-error">{error}</p> : null}
      <div className="pitch-button-row">
        <select
          aria-label="Pitch type"
          className="pitch-type-select"
          disabled={starting}
          onChange={(e) => setPitchType(e.target.value as PitchType)}
          value={pitchType}
        >
          <option value="sponsored_article">Sponsored article</option>
          <option value="advertisement">Advertisement</option>
        </select>
        <button
          className="button button-secondary"
          disabled={starting}
          onClick={() => void launch(`/api/businesses/${businessId}/pitch`, { pitchType })}
          type="button"
        >
          {starting ? "Starting…" : "Pitch"}
        </button>
      </div>
    </div>
  );
}
