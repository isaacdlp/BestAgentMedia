import Link from "next/link";
import { formatCents } from "@/lib/promotion-packages";
import { readSaleProposal, type PromotionSaleSummary } from "@/lib/promotion-sales";

const SALE_LABELS: Record<PromotionSaleSummary["status"], string> = {
  PROPOSED: "Offer sent",
  NEGOTIATING: "Negotiating",
  PURCHASED: "Purchased",
  DECLINED: "Declined",
};

const SALE_PILLS: Record<PromotionSaleSummary["status"], string> = {
  PROPOSED: "promotion-deal-proposed",
  NEGOTIATING: "promotion-deal-interested",
  PURCHASED: "promotion-deal-signed_up",
  DECLINED: "promotion-deal-declined",
};

/** Status, current offer and purchased placements of one Promote sales conversation (task page). */
export function PromotionSaleDetails({ sale, showConversationLink }: { sale: PromotionSaleSummary; showConversationLink: boolean }) {
  const proposal = readSaleProposal(sale.proposal);
  const purchasedTotal = sale.items.reduce((sum, item) => sum + item.priceCents, 0);
  const purchasedList = sale.items.reduce((sum, item) => sum + item.listPriceCents, 0);
  return (
    <>
      <dl className="task-email-meta promotion-deal-meta">
        <dt>Business</dt>
        <dd>
          <Link className="text-link" href={`/businesses/${sale.business.id}`}>{sale.business.name}</Link>
          {sale.business.email ? ` · ${sale.business.email}` : ""}
        </dd>
        <dt>Handled by</dt>
        <dd>{sale.subAgent?.name ?? "Unassigned"}</dd>
        <dt>Issue</dt>
        <dd>
          <Link className="text-link" href={`/publications/${sale.publication.id}`}>{sale.publication.name}</Link>
          {" · "}
          {sale.issue ? (
            <Link className="text-link" href={`/issues/${sale.issue.id}`}>
              {sale.issue.name} ({sale.issue.publicationDate.toISOString().slice(0, 10)})
            </Link>
          ) : (
            "issue deleted"
          )}
        </dd>
        {sale.article ? (
          <>
            <dt>Article</dt>
            <dd>
              <Link className="text-link" href={`/articles/${sale.article.id}`}>{sale.article.title}</Link>
            </dd>
          </>
        ) : null}
        <dt>Sale</dt>
        <dd>
          <span className={`promotion-pill ${SALE_PILLS[sale.status]}`}>{SALE_LABELS[sale.status]}</span>
          {sale.optedOut ? " · asked not to be contacted" : ""}
        </dd>
        {proposal?.items.length && sale.status !== "PURCHASED" ? (
          <>
            <dt>Current offer</dt>
            <dd>
              {proposal.items.map((item) => `${item.packageName} in ${item.issueName}`).join(" + ")}
              {proposal.discountPercent ? ` · ${proposal.discountPercent}% bundle discount` : ""}
              {` · ${formatCents(proposal.totalCents)}`}
            </dd>
          </>
        ) : null}
        {sale.instructions ? (
          <>
            <dt>Instructions</dt>
            <dd style={{ whiteSpace: "pre-wrap" }}>{sale.instructions}</dd>
          </>
        ) : null}
        <dt>Started</dt>
        <dd>{sale.createdAt.toLocaleString()}</dd>
        <dt>Last reply</dt>
        <dd>{sale.lastInboundAt?.toLocaleString() ?? "No reply yet"}</dd>
        {sale.followUpSentAt ? (
          <>
            <dt>Follow-up</dt>
            <dd>{sale.followUpSentAt.toLocaleString()}</dd>
          </>
        ) : null}
        {sale.purchasedAt ? (
          <>
            <dt>Purchased</dt>
            <dd>{sale.purchasedAt.toLocaleString()}</dd>
          </>
        ) : null}
      </dl>

      {sale.items.length ? (
        <>
          <h3>Purchased placements</h3>
          <div className="table-wrap">
            <table className="promotion-sale-items">
              <thead>
                <tr>
                  <th>Placement</th>
                  <th>Issue</th>
                  <th className="num">List price</th>
                  <th className="num">Discount</th>
                  <th className="num">Agreed price</th>
                  <th>Draft</th>
                </tr>
              </thead>
              <tbody>
                {sale.items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.packageName} <span className="muted">({item.kind === "AD" ? "ad" : "sponsored article"})</span></td>
                    <td>{item.issue?.name ?? "—"}</td>
                    <td className="num">{formatCents(item.listPriceCents)}</td>
                    <td className="num">{item.discountPercent ? `${item.discountPercent}%` : "—"}</td>
                    <td className="num">{formatCents(item.priceCents)}</td>
                    <td>
                      {item.advertisementId ? (
                        <Link className="text-link" href={`/ads/${item.advertisementId}`}>Open draft ad</Link>
                      ) : item.articleId ? (
                        <Link className="text-link" href={`/articles/${item.articleId}`}>Open draft article</Link>
                      ) : (
                        <span className="muted">Deleted</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total</td>
                  <td className="num">{formatCents(purchasedList)}</td>
                  <td />
                  <td className="num">{formatCents(purchasedTotal)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="muted promotion-deal-note">
            The business agreed by email. No payment was collected: the publication team sends the agreement and invoice. The
            drafts are generated proposals; review them, then use Submit for Review to get the advertiser&rsquo;s approval.
          </p>
        </>
      ) : null}

      {showConversationLink && sale.subAgent && sale.threadId ? (
        <Link className="text-link" href={`/agents/${sale.subAgent.agentId}/sub-agents/${sale.subAgent.id}?thread=${encodeURIComponent(sale.threadId)}`}>
          View conversation ({sale.thread?._count.messages ?? 0} messages) →
        </Link>
      ) : null}
    </>
  );
}
