"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RequestInfoButton({
  apiPath,
  agentPath,
}: {
  apiPath: string;
  agentPath: string;
}) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleRequest() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(apiPath, { method: "POST" });
      const result = (await response.json()) as { taskId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Request failed.");
      router.push(agentPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setLoading(false);
    }
  }

  return (
    <div className="review-button-wrap">
      {error ? <p className="form-error review-button-error">{error}</p> : null}
      <button
        className="button button-secondary"
        disabled={loading}
        onClick={() => void handleRequest()}
        type="button"
      >
        {loading ? "Requesting…" : "Request Info"}
      </button>
    </div>
  );
}
