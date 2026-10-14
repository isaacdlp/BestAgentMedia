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

type SubmissionReviewsProps = {
  reviews: Review[];
};

export function SubmissionReviews({ reviews }: SubmissionReviewsProps) {
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
