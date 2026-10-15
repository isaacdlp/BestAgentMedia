"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

const MAX_COMMENTS = 4000;

type Decision = "APPROVED" | "CHANGES_REQUESTED";

/** Approve / request changes form on the public ad review page. */
export function AdReviewForm({ token, marketerName }: { token: string; marketerName: string | null }) {
  const router = useRouter();
  const [decision, setDecision] = useState<Decision | null>(null);
  const [comments, setComments] = useState("");
  const [reviewerName, setReviewerName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState<Decision | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!decision) {
      setError("Choose Approve or Request changes.");
      return;
    }
    if (decision === "CHANGES_REQUESTED" && !comments.trim()) {
      setError("Describe the changes you would like.");
      return;
    }
    setSubmitting(true);
    setError("");
    try {
      const response = await fetch(`/api/review/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, comments, reviewerName }),
      });
      const result = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Your review could not be saved. Please try again.");
      setSubmitted(decision);
      setComments("");
      setDecision(null);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Your review could not be saved. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <div className="public-submission-success">
        <span className="public-submission-success-mark" aria-hidden="true">✓</span>
        <h2>{submitted === "APPROVED" ? "Thanks — your ad is approved" : "Thanks — we got your changes"}</h2>
        <p className="muted">
          {submitted === "APPROVED"
            ? "We've recorded your approval."
            : "The team will prepare a revised version and send it to you for review through this same link."}{" "}
          {marketerName ?? "Your contact at the publication"} will follow up by email.
        </p>
        <button className="button button-secondary" onClick={() => setSubmitted(null)} type="button">
          Add another review
        </button>
      </div>
    );
  }

  return (
    <form className="ad-review-page-form" onSubmit={(e) => void handleSubmit(e)}>
      <h2>Your review</h2>
      <fieldset className="ad-review-page-choices">
        <legend>Decision</legend>
        {(
          [
            ["APPROVED", "Approve this ad"],
            ["CHANGES_REQUESTED", "Request changes"],
          ] as const
        ).map(([value, label]) => (
          <label className={`ad-review-page-choice${decision === value ? " ad-review-page-choice-selected" : ""}`} key={value}>
            <input checked={decision === value} name="decision" onChange={() => setDecision(value)} type="radio" value={value} />
            {label}
          </label>
        ))}
      </fieldset>
      <label className="business-field">
        <span>
          {decision === "CHANGES_REQUESTED" ? "What should we change?" : "Comments"}{" "}
          {decision === "CHANGES_REQUESTED" ? null : <span className="muted">(optional)</span>}
        </span>
        <textarea
          maxLength={MAX_COMMENTS}
          onChange={(e) => setComments(e.target.value)}
          placeholder={
            decision === "CHANGES_REQUESTED"
              ? "For example: use our new phone number, make the logo bigger, change the offer to 15% off…"
              : "Anything you'd like us to know"
          }
          value={comments}
        />
      </label>
      <label className="business-field">
        <span>
          Your name <span className="muted">(optional)</span>
        </span>
        <input maxLength={120} onChange={(e) => setReviewerName(e.target.value)} type="text" value={reviewerName} />
      </label>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="public-submission-actions">
        <span className="muted" style={{ fontSize: 12, alignSelf: "center" }}>
          You can also reply to our email instead.
        </span>
        <button className="button button-primary" disabled={submitting} type="submit">
          {submitting ? "Sending…" : "Send review"}
        </button>
      </div>
    </form>
  );
}
