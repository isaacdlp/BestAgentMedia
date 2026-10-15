import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AD_REVIEW_DECISION_LABELS, getPublicAdReview } from "@/lib/ad-reviews";
import { AdReviewForm } from "./ad-review-form";

export const metadata: Metadata = {
  title: "Review your ad | BestAgentMedia",
  description: "Approve your ad or request changes.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/** Public, no login: the advertiser's review page linked from the Marketer's email. */
export default async function AdReviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const review = await getPublicAdReview(token);
  if (!review) notFound();

  const { advertisement: ad } = review;
  const issueLabel = review.issue
    ? `${review.issue.name} · ${review.issue.publicationDate.toISOString().slice(0, 10)}`
    : "The next issue";

  return (
    <main className="public-submission-page">
      <header className="public-submission-header">
        <span className="public-submission-brand">
          <span className="brand-mark">B</span>
          <span>{review.publication?.name ?? "BestAgentMedia"}</span>
        </span>
        <span>Advertiser ad review</span>
      </header>
      <div className="public-submission-content">
        <div className="public-submission-heading">
          <p className="eyebrow">YOUR AD FOR REVIEW</p>
          <h1>{ad.title}</h1>
          <p className="muted">
            Prepared for {review.business.name}. Please approve it as it is, or tell us what to change.
          </p>
        </div>

        <div className="public-submission-card ad-review-page-card">
          <div className="ad-review-page-artwork">
            {ad.creativeFileName ? (
              <img
                alt={`Ad artwork: ${ad.title}`}
                src={`/api/review/${encodeURIComponent(token)}/creative?v=${encodeURIComponent(ad.creativeFileName.slice(0, 8))}`}
              />
            ) : (
              <p className="muted">The artwork is still being finalized. You can already review the copy below.</p>
            )}
          </div>

          <dl className="ad-review-page-details">
            <div>
              <dt>Headline</dt>
              <dd>{ad.title}</dd>
            </div>
            {ad.description ? (
              <div>
                <dt>Copy</dt>
                <dd>{ad.description}</dd>
              </div>
            ) : null}
            {ad.styleName ? (
              <div>
                <dt>Size</dt>
                <dd>{ad.styleName}</dd>
              </div>
            ) : null}
            <div>
              <dt>Issue</dt>
              <dd>
                {review.publication ? `${review.publication.name} · ` : ""}
                {issueLabel}
              </dd>
            </div>
          </dl>

          {review.adReviews.length ? (
            <div>
              <p className="muted" style={{ margin: "0 0 8px", fontSize: 12 }}>
                Your earlier reviews
              </p>
              <ol className="ad-review-page-history">
                {review.adReviews.map((item) => (
                  <li key={item.id}>
                    <strong>{AD_REVIEW_DECISION_LABELS[item.decision]}</strong> · {item.createdAt.toLocaleDateString("en-US")}
                    {item.comments ? `\n${item.comments}` : ""}
                  </li>
                ))}
              </ol>
            </div>
          ) : null}

          {review.state === "open" ? (
            <AdReviewForm marketerName={review.subAgent?.name ?? null} token={token} />
          ) : (
            <p className="muted" style={{ margin: 0 }}>
              {review.state === "superseded"
                ? "A newer review link was sent for this ad. Please use the link in the latest email."
                : "This review is closed. Please reply to the email from the publication team if you have any questions."}
            </p>
          )}
        </div>
      </div>
      <footer className="public-submission-footer">
        Your review is sent to the publication team and recorded with this ad. No account is needed.
      </footer>
    </main>
  );
}
