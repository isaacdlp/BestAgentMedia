"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

type PitchType = "sponsored_article" | "advertisement";

export function PitchButton({
  businessId,
  agentPath,
}: {
  businessId: number;
  agentPath: string;
}) {
  const router = useRouter();
  const [pitchType, setPitchType] = useState<PitchType>("sponsored_article");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handlePitch() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/businesses/${businessId}/pitch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pitchType }),
      });
      const result = (await response.json()) as { taskId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Pitch failed.");
      router.push(agentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Pitch failed.");
      setLoading(false);
    }
  }

  return (
    <div className="pitch-button-wrap">
      {error ? <p className="form-error pitch-button-error">{error}</p> : null}
      <div className="pitch-button-row">
        <select
          aria-label="Pitch type"
          className="pitch-type-select"
          disabled={loading}
          onChange={(e) => setPitchType(e.target.value as PitchType)}
          value={pitchType}
        >
          <option value="sponsored_article">Sponsored article</option>
          <option value="advertisement">Advertisement</option>
        </select>
        <button
          className="button button-secondary"
          disabled={loading}
          onClick={() => void handlePitch()}
          type="button"
        >
          {loading ? "Drafting…" : "Pitch"}
        </button>
      </div>
    </div>
  );
}
