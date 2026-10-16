import Link from "next/link";
import { AgentBadge } from "@/components/agent-badge";
import { reviewUrl } from "@/lib/ad-reviews";
import { formatCents } from "@/lib/promotion-packages";
import type { PromotionDealSummary } from "@/lib/promotion-deals";
import { TASK_STATUS_LABELS } from "@/lib/task-status";

const CONTENT_LABELS: Record<PromotionDealSummary["contentStatus"], string> = {
  PENDING: "Awaiting advertiser review",
  APPROVED: "Approved by advertiser",
  CHANGES_REQUESTED: "Changes requested",
};

const DEAL_LABELS: Record<PromotionDealSummary["status"], string> = {
  PROPOSED: "Proposal sent",
  INTERESTED: "Interested",
  SIGNED_UP: "Signed up",
  DECLINED: "Declined",
};

/** Status details of one review/promotion conversation (used on ad, article and task pages). */
export function PromotionDealDetails({
  deal,
  showConversationLink,
  showTaskLink = true,
}: {
  deal: PromotionDealSummary;
  showConversationLink: boolean;
  showTaskLink?: boolean;
}) {
  const taskId = deal.agentTask.registry?.id;
  return (
    <>
      <dl className="task-email-meta promotion-deal-meta">
        {showTaskLink ? (
          <>
            <dt>Task</dt>
            <dd>
              {taskId ? (
                <Link className="text-link" href={`/tasks/${taskId}`}>
                  #{taskId} · {TASK_STATUS_LABELS[deal.agentTask.status]}
                </Link>
              ) : (
                TASK_STATUS_LABELS[deal.agentTask.status]
              )}
            </dd>
          </>
        ) : null}
        <dt>Advertiser</dt>
        <dd>
          <Link className="text-link" href={`/businesses/${deal.business.id}`}>{deal.business.name}</Link>
          {deal.business.email ? ` · ${deal.business.email}` : ""}
        </dd>
        <dt>Handled by</dt>
        <dd>{deal.subAgent?.name ?? "Unassigned"}</dd>
        <dt>Issue</dt>
        <dd>
          {deal.publication ? (
            <Link className="text-link" href={`/publications/${deal.publication.id}`}>{deal.publication.name}</Link>
          ) : (
            "No publication"
          )}
          {" · "}
          {deal.issue ? deal.issue.name : "next issue (none assigned)"}
        </dd>
        <dt>Content review</dt>
        <dd>
          <span className={`promotion-pill promotion-content-${deal.contentStatus.toLowerCase()}`}>
            {CONTENT_LABELS[deal.contentStatus]}
          </span>
        </dd>
        {deal.advertisementId ? (
          deal.status === "DECLINED" ? (
            <>
              <dt>Status</dt>
              <dd>
                <span className="promotion-pill promotion-deal-declined">Wants to stop</span>
                {deal.optedOut ? " · asked not to be contacted" : ""}
              </dd>
            </>
          ) : null
        ) : (
          <>
            <dt>Promotion</dt>
            <dd>
              <span className={`promotion-pill promotion-deal-${deal.status.toLowerCase()}`}>{DEAL_LABELS[deal.status]}</span>
              {deal.packageName ? ` ${deal.packageName}` : ""}
              {deal.priceCents != null ? ` · ${formatCents(deal.priceCents)}` : ""}
              {deal.optedOut ? " · asked not to be contacted" : ""}
            </dd>
          </>
        )}
        {deal.reviewToken ? (
          <>
            <dt>Review page</dt>
            <dd>
              <a className="text-link" href={reviewUrl(deal.reviewToken)} rel="noreferrer" target="_blank">
                Open the advertiser&apos;s review page
              </a>
              {deal.advertisementId ? (
                <>
                  {" · "}
                  <Link className="text-link" href={`/ads/${deal.advertisementId}?tab=reviews`}>Ad reviews</Link>
                </>
              ) : null}
            </dd>
          </>
        ) : null}
        {deal.instructions ? (
          <>
            <dt>Instructions</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{deal.instructions}</dd>
          </>
        ) : null}
        <dt>Submitted</dt>
        <dd>{deal.createdAt.toLocaleString()}</dd>
        <dt>Last reply</dt>
        <dd>{deal.lastInboundAt?.toLocaleString() ?? "No reply yet"}</dd>
        {deal.followUpSentAt ? (
          <>
            <dt>Follow-up</dt>
            <dd>{deal.followUpSentAt.toLocaleString()}</dd>
          </>
        ) : null}
      </dl>
      {deal.status === "SIGNED_UP" ? (
        <p className="muted promotion-deal-note">
          The advertiser confirmed by email{deal.signedUpAt ? ` on ${deal.signedUpAt.toLocaleDateString()}` : ""}. No
          payment was collected — the publication team sends the agreement and invoice.
        </p>
      ) : null}
      {deal.requestedChanges ? (
        <div className="promotion-deal-changes">
          <strong>Requested changes</strong>
          <pre>{deal.requestedChanges}</pre>
        </div>
      ) : null}
      {showConversationLink && deal.subAgent && deal.threadId ? (
        <Link className="text-link" href={`/agents/${deal.subAgent.agentId}/sub-agents/${deal.subAgent.id}?thread=${encodeURIComponent(deal.threadId)}`}>
          View conversation ({deal.thread?._count.messages ?? 0} messages) →
        </Link>
      ) : null}
    </>
  );
}

/** Ad/article page panel: who handles the review and where the latest conversation stands. */
export function PromotionDealPanel({
  deal,
  kind,
  businessName,
  businessEmail,
  showConversationLink,
}: {
  deal: PromotionDealSummary | null;
  kind: "ad" | "article";
  businessName: string | null;
  businessEmail: string | null;
  showConversationLink: boolean;
}) {
  return (
    <section className="panel promotion-deal-panel">
      <div className="panel-heading">
        <h2>Advertiser review &amp; promotion</h2>
        <AgentBadge agentSlug="marketer" subAgentId={deal?.subAgent?.id} />
      </div>
      {deal ? (
        <PromotionDealDetails deal={deal} showConversationLink={showConversationLink} />
      ) : (
        <p className="muted promotion-deal-empty">
          {!businessName
            ? `Link this ${kind} to a business to submit it for review.`
            : !businessEmail
              ? `${businessName} has no email address on record, so this ${kind} cannot be submitted for review yet.`
              : `Not submitted yet. Submit for Review emails this ${kind} to ${businessName} for approval, and the Marketer offers a paid placement in the issue. Replies are answered automatically and recorded here.`}
        </p>
      )}
    </section>
  );
}
