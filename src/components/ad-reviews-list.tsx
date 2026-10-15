import Link from "next/link";
import { AD_REVIEW_DECISION_LABELS, AD_REVIEW_SOURCE_LABELS, type AdReviewEntry } from "@/lib/ad-reviews";

/** The ad's Reviews tab: every advertiser review in order, oldest first. */
export function AdReviewsList({
  reviews,
  currentCreativeFileName,
  reviewLink,
  showTaskLinks,
}: {
  reviews: AdReviewEntry[];
  currentCreativeFileName: string | null;
  /** The latest review conversation's public link, for staff. */
  reviewLink: { url: string; open: boolean } | null;
  showTaskLinks: boolean;
}) {
  return (
    <section className="panel ad-reviews">
      <div className="panel-heading">
        <h2>
          Advertiser reviews <span className="count-badge">{reviews.length}</span>
        </h2>
      </div>
      <p className="muted ad-reviews-intro">
        Reviews from the advertiser&apos;s online review page and their email replies, in the order they arrived. The
        Creative receives them when the ad is generated or iterated.
      </p>
      {reviewLink ? (
        <p className="ad-reviews-link">
          Advertiser review link{reviewLink.open ? "" : " (closed)"}:{" "}
          <a className="text-link" href={reviewLink.url} rel="noreferrer" target="_blank">
            {reviewLink.url}
          </a>
        </p>
      ) : null}

      {reviews.length ? (
        <ol className="ad-review-list">
          {reviews.map((review, index) => {
            const taskId = review.promotionDeal?.agentTask.registry?.id;
            const artwork = !review.creativeFileName
              ? "Reviewed before the ad artwork was ready"
              : review.creativeFileName === currentCreativeFileName
                ? "Reviewed the current artwork"
                : "Reviewed an earlier version of the artwork";
            return (
              <li className="ad-review" key={review.id}>
                <div className="ad-review-head">
                  <span className="ad-review-number">#{index + 1}</span>
                  <span
                    className={`promotion-pill ${review.decision === "APPROVED" ? "promotion-content-approved" : "promotion-content-changes_requested"}`}
                  >
                    {AD_REVIEW_DECISION_LABELS[review.decision]}
                  </span>
                  <span className="muted">
                    {AD_REVIEW_SOURCE_LABELS[review.source]}
                    {review.reviewerName ? ` · ${review.reviewerName}` : ""} · {review.createdAt.toLocaleString()}
                  </span>
                </div>
                {review.comments ? (
                  <p className="ad-review-comments">{review.comments}</p>
                ) : (
                  <p className="muted ad-review-comments">No comments.</p>
                )}
                <p className="muted ad-review-meta">
                  {artwork}
                  {review.promotionDeal?.subAgent ? ` · handled by ${review.promotionDeal.subAgent.name}` : ""}
                  {showTaskLinks && taskId ? (
                    <>
                      {" · "}
                      <Link className="text-link" href={`/tasks/${taskId}`}>
                        Task #{taskId}
                      </Link>
                    </>
                  ) : null}
                </p>
              </li>
            );
          })}
        </ol>
      ) : (
        <div className="empty-state">
          No reviews yet. Use Submit for Review to send the ad to the advertiser for approval.
        </div>
      )}
    </section>
  );
}
