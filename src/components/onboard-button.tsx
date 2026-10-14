"use client";

import { useTaskLauncher } from "@/components/use-task-launcher";

/**
 * Launches the onboarding Task for a single business, bypassing the selection screen.
 * Disabled when the business is already claimed by a user or has no email address.
 */
export function OnboardButton({
  businessId,
  claimed,
  hasEmail,
}: {
  businessId: number;
  claimed: boolean;
  hasEmail: boolean;
}) {
  const { launch, starting, error } = useTaskLauncher();
  const title = claimed
    ? "This business is already claimed by a user."
    : !hasEmail
      ? "This business has no email address on record."
      : "Start the onboarding email sequence for this business.";

  return (
    <div className="pitch-button-wrap">
      {error ? <p className="form-error pitch-button-error">{error}</p> : null}
      <button
        className="button button-primary"
        disabled={claimed || !hasEmail || starting}
        onClick={() => void launch("/api/reachout-tasks", { businessIds: [businessId] })}
        style={claimed || !hasEmail ? { cursor: "not-allowed" } : undefined}
        title={title}
        type="button"
      >
        {starting ? "Starting…" : "Onboard"}
      </button>
    </div>
  );
}
