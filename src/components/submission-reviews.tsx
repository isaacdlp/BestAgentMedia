import Link from "next/link";
import { AgentPromptButton } from "@/components/agent-prompt-button";

type ReviewResult = {
  headlineSuggestion?: string | null;
  summary?: string | null;
  strengths?: string[];
  suggestions?: string[];
  missingElements?: string[];
  readabilityScore?: number | null;
  communityRelevanceScore?: number | null;
  deltaReadability?: number | null;
  deltaCommunityRelevance?: number | null;
  resolvedElements?: string[];
  newConcerns?: string[];
};

type Review = {
  id: string;
  label: string;
  result: unknown;
  completedAt: Date | string | null;
  triggeredBy: { name: string | null; surname: string | null } | null;
};

type ReviewActivity = {
  taskId: number | null;
  reviewTaskId: string;
  kind: "info-request" | "applied";
  status: string;
  at: Date | string;
};

type ReceivedInfo = {
  reviewTaskId: string;
  taskId: number | null;
  topic: string;
  detail: string;
  receivedAt: string;
};

type SubmissionReviewsProps = {
  activity: ReviewActivity[];
  canApply: boolean;
  canRequestInfo: boolean;
  /** Information the Assistant recorded from the submitter's replies, per review. */
  receivedInfo: ReceivedInfo[];
  /** Replies received from the submitter on info requests for this submission. */
  replyCount: number;
  reviews: Review[];
  submissionId: string;
};

const activityLabels: Record<string, string> = {
  "info-request:draft": "Info request drafted",
  "info-request:running": "Sending info request…",
  "info-request:sent": "Info requested · awaiting reply",
  "info-request:incorporated": "Partial info received · following up",
  "info-request:complete": "Info received",
  "info-request:no-response": "No reply from submitter",
  "info-request:stopped": "Info request stopped",
  "info-request:failed": "Info request failed",
  "applied:pending": "Applying…",
  "applied:running": "Applying…",
  "applied:pending_review": "Revision ready · awaiting approval",
  "applied:accepted": "Revision applied",
  "applied:discarded": "Revision discarded",
  "applied:stopped": "Apply stopped",
  "applied:failed": "Apply failed",
};

export function SubmissionReviews({
  activity,
  canApply,
  canRequestInfo,
  receivedInfo,
  replyCount,
  reviews,
  submissionId,
}: SubmissionReviewsProps) {
  if (reviews.length === 0) {
    return (
      <section className="panel">
        <p className="muted">No reviews yet. Use the <strong>Review</strong> button to request an editorial review.</p>
      </section>
    );
  }

  return (
    <div className="submission-reviews-list">
      {reviews.map((review, index) => {
        const result = (review.result ?? {}) as ReviewResult;
        const completedAt = review.completedAt ? new Date(review.completedAt) : null;
        const reviewer = review.triggeredBy
          ? [review.triggeredBy.name, review.triggeredBy.surname].filter(Boolean).join(" ")
          : null;
        const isLatest = index === 0;
        const info = receivedInfo.filter((item) => item.reviewTaskId === review.id);

        return (
          <section className="panel submission-review-card" key={review.id}>
            <div className="submission-review-header">
              <div className="submission-review-meta">
                {isLatest && <span className="role-pill submission-review-latest-pill">Latest</span>}
                <span className="submission-review-date">
                  {completedAt ? completedAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "Unknown date"}
                  {reviewer ? ` · Reviewed by ${reviewer}` : ""}
                </span>
              </div>
              <div className="submission-review-scores">
                <ScoreBadge label="Readability" score={result.readabilityScore ?? null} delta={result.deltaReadability ?? null} />
                <ScoreBadge label="Relevance" score={result.communityRelevanceScore ?? null} delta={result.deltaCommunityRelevance ?? null} />
              </div>
            </div>

            {result.summary ? (
              <p className="submission-review-summary">{result.summary}</p>
            ) : null}

            {result.headlineSuggestion ? (
              <div className="submission-review-section">
                <p className="submission-review-section-label">Headline suggestion</p>
                <p className="submission-review-headline">&ldquo;{result.headlineSuggestion}&rdquo;</p>
              </div>
            ) : null}

            <div className="submission-review-columns">
              {result.strengths && result.strengths.length > 0 ? (
                <div className="submission-review-section">
                  <p className="submission-review-section-label">Strengths</p>
                  <ul className="submission-review-list submission-review-list-strengths">
                    {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              ) : null}

              {result.suggestions && result.suggestions.length > 0 ? (
                <div className="submission-review-section">
                  <p className="submission-review-section-label">Suggestions</p>
                  <ul className="submission-review-list submission-review-list-suggestions">
                    {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              ) : null}

              {result.missingElements && result.missingElements.length > 0 ? (
                <div className="submission-review-section">
                  <p className="submission-review-section-label">Missing elements</p>
                  <ul className="submission-review-list submission-review-list-missing">
                    {result.missingElements.map((s, i) => <li key={i}>{s}</li>)}
                  </ul>
                </div>
              ) : null}
            </div>

            {/* Delta section — only on re-reviews */}
            {(result.resolvedElements?.length || result.newConcerns?.length) ? (
              <div className="submission-review-delta">
                {result.resolvedElements && result.resolvedElements.length > 0 ? (
                  <div className="submission-review-section">
                    <p className="submission-review-section-label">Resolved since last review</p>
                    <ul className="submission-review-list submission-review-list-resolved">
                      {result.resolvedElements.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                ) : null}
                {result.newConcerns && result.newConcerns.length > 0 ? (
                  <div className="submission-review-section">
                    <p className="submission-review-section-label">New concerns</p>
                    <ul className="submission-review-list submission-review-list-concerns">
                      {result.newConcerns.map((s, i) => <li key={i}>{s}</li>)}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}

            {info.length ? (
              <div className="submission-review-section submission-review-received">
                <p className="submission-review-section-label">Information from the submitter</p>
                <ul className="submission-review-list submission-review-list-received">
                  {info.map((item, itemIndex) => (
                    <li key={itemIndex}>
                      {item.topic ? <strong>{item.topic}: </strong> : null}
                      {item.detail}
                      {item.receivedAt ? (
                        <span className="muted">
                          {" · "}
                          {new Date(item.receivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
                <p className="muted submission-review-received-note">
                  Recorded by the Assistant from the submitter&rsquo;s replies. The story text is unchanged until you
                  use <strong>Apply</strong> and accept the Copywriter&rsquo;s revision.
                </p>
              </div>
            ) : null}

            <div className="submission-review-actions">
              <div className="submission-review-activity">
                {activity
                  .filter((item) => item.reviewTaskId === review.id)
                  .map((item, itemIndex) => {
                    const text = activityLabels[`${item.kind}:${item.status}`] ?? `${item.kind === "applied" ? "Apply" : "Info request"}: ${item.status}`;
                    const date = new Date(item.at).toLocaleDateString("en-US", { month: "short", day: "numeric" });
                    const content = `${text} · ${date}`;
                    return item.taskId ? (
                      <Link className={`role-pill submission-review-activity-${item.kind}`} href={`/tasks/${item.taskId}`} key={itemIndex}>
                        {content}
                      </Link>
                    ) : (
                      <span className={`role-pill submission-review-activity-${item.kind}`} key={itemIndex}>{content}</span>
                    );
                  })}
              </div>
              <div className="submission-review-buttons">
                {canRequestInfo ? (
                  <AgentPromptButton
                    agentSlug="assistant"
                    apiPath={`/api/submissions/${submissionId}/clarify`}
                    body={{ reviewTaskId: review.id }}
                    buttonLabel="Request Info"
                    description="The Assistant emails the submitter right away asking for what this review needs, answers their replies, and follows up if they go quiet, until nothing is missing. What they send is recorded on this review (photos are added to the submission); the story text changes only through Apply."
                    dialogTitle="Request info from the submitter"
                    placeholder="Anything the Assistant should ask for or mention in the conversation…"
                    startLabel="Send request"
                    suggestions={[
                      "Ask them to add anything else",
                      "Ask for high-resolution photos",
                      "Ask for a short quote",
                      "Keep it very short",
                    ]}
                  />
                ) : null}
                {canApply ? (
                  <AgentPromptButton
                    agentSlug="editor"
                    apiPath={`/api/submissions/${submissionId}/apply`}
                    body={{ reviewTaskId: review.id }}
                    buttonLabel="Apply"
                    description={`The Copywriter drafts a revised title and story from the submission, this review${replyCount ? ` and the ${replyCount} reply message${replyCount === 1 ? "" : "s"} received from the submitter` : ""}. Facts are never invented. When the task finishes, the current and revised versions are shown side by side, and the submission changes only if you accept the revision.`}
                    dialogTitle="Apply review to the submission"
                    placeholder="Anything the Copywriter should change, keep, or emphasize…"
                    startLabel="Draft revision"
                    suggestions={["Keep the original headline", "Keep it under 400 words", "Only fix grammar and clarity"]}
                    variant="primary"
                  />
                ) : null}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function ScoreBadge({ label, score, delta }: { label: string; score: number | null; delta: number | null }) {
  const scoreColor =
    score === null ? "" :
    score >= 8 ? "score-high" :
    score >= 5 ? "score-mid" :
    "score-low";

  return (
    <div className="submission-review-score-badge">
      <span className="submission-review-score-label">{label}</span>
      <span className={`submission-review-score-value ${scoreColor}`}>
        {score !== null ? `${score}/10` : "—"}
      </span>
      {delta !== null && delta !== 0 ? (
        <span className={`submission-review-score-delta ${delta > 0 ? "delta-up" : "delta-down"}`}>
          {delta > 0 ? `+${delta}` : delta}
        </span>
      ) : null}
    </div>
  );
}
