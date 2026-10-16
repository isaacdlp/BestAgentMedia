import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { ArticleEditor } from "@/components/article-editor";
import { updateArticleStatus } from "@/app/actions/content";
import { AgentPromptButton } from "@/components/agent-prompt-button";
import { ArticlePromoteButton, type ArticlePromoteIssueOption } from "@/components/article-promote-button";
import { SubmitReviewButton } from "@/components/submit-review-button";
import { getArticleScope, listIssueOptions } from "@/lib/access";
import { ARTICLE_WORDS_PER_PAGE, DEFAULT_ARTICLE_PAGES } from "@/lib/article-enhance";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { listAdStyleOptions } from "@/lib/ad-styles";
import { getLatestPromotionDeal, MAX_PROMOTION_INSTRUCTIONS } from "@/lib/promotion-deals";
import { promotableIssueWhere } from "@/lib/promotion-sales";

export default async function ArticlePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const scope = await getArticleScope(user);
  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();
  const article = await prisma.article.findFirst({
    where: { id, ...scope },
    include: {
      sourceSubmission: { select: { id: true, title: true } },
      images: {
        orderBy: [{ position: "asc" }, { createdAt: "asc" }],
        select: { id: true, originalName: true, mimeType: true, size: true },
      },
      issues: {
        select: {
          issueId: true,
          issue: { select: { name: true, publicationId: true, publication: { select: { name: true } } } },
        },
      },
      business: { select: { id: true, name: true, email: true, postalCode: true } },
      placements: {
        include: {
          page: {
            select: {
              pageNumber: true,
              issue: {
                select: {
                  id: true,
                  status: true,
                  publicationDate: true,
                  publication: { select: { name: true } },
                },
              },
            },
          },
        },
      },
    },
  });
  if (!article) notFound();

  const canEdit = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;
  const isAdmin = user.role === UserRole.ADMIN;
  const [editorAgent, marketerAgent] = canEdit
    ? await Promise.all([
        prisma.agent.findUnique({ where: { slug: "editor" }, select: { id: true, enabled: true } }),
        prisma.agent.findUnique({ where: { slug: "marketer" }, select: { enabled: true } }),
      ])
    : [null, null];
  const { business } = article;
  // A paid article goes to its business for review; an unpaid one can only be sold with Promote.
  const isPaid = article.promotionPackageId !== null;
  const canSubmitReview = isPaid && Boolean(marketerAgent?.enabled);
  const canPromote = !isPaid && isAdmin && Boolean(marketerAgent?.enabled);
  const reviewDeal = canSubmitReview ? await getLatestPromotionDeal({ articleId: article.id }) : null;
  const reviewOpen = reviewDeal?.agentTask.status === "RUNNING" || reviewDeal?.agentTask.status === "PENDING";
  // Promote: upcoming issues the article is slated for, or whose publication serves the business's ZIP code
  const [promoteIssues, openSale] = canPromote && business
    ? await Promise.all([
        prisma.issue.findMany({
          where: {
            ...promotableIssueWhere(),
            OR: [
              { articles: { some: { articleId: article.id } } },
              ...(business.postalCode ? [{ publication: { zipCodes: { some: { code: business.postalCode } } } }] : []),
            ],
          },
          orderBy: [{ publicationDate: "asc" }, { name: "asc" }],
          select: {
            id: true,
            name: true,
            publicationDate: true,
            articles: { where: { articleId: article.id }, select: { articleId: true } },
            publication: { select: { name: true, _count: { select: { promotionPackages: true } } } },
          },
        }),
        prisma.promotionSale.findFirst({
          where: { articleId: article.id, agentTask: { status: { in: ["PENDING", "RUNNING"] } } },
          select: { id: true },
        }),
      ])
    : [[], null];
  const promoteIssueOptions: ArticlePromoteIssueOption[] = promoteIssues.map((issue) => ({
    id: issue.id,
    label: `${issue.publication.name} · ${issue.name} · ${issue.publicationDate.toISOString().slice(0, 10)}`,
    hasRates: issue.publication._count.promotionPackages > 0,
    slated: issue.articles.length > 0,
  }));
  const promoteDisabledReason = !business
    ? "Link the article to a business to promote it."
    : !business.email
      ? `${business.name} has no email address on record.`
      : openSale
        ? "A promotion conversation for this article is already open."
        : null;
  const [issues, businesses] = await Promise.all([
    canEdit
      ? listIssueOptions(user)
      : Promise.resolve(
          article.issues.map(({ issueId, issue }) => ({
            id: issueId,
            name: `${issue.publication.name} · ${issue.name}`,
            publicationId: issue.publicationId,
          })),
        ),
    canEdit
      ? prisma.business.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, city: true, stateCode: true, postalCode: true, primaryCategory: true },
        })
      : Promise.resolve([]),
  ]);
  const promotionStyles = canEdit ? await listAdStyleOptions(issues.map((issue) => issue.publicationId), "ARTICLE") : [];
  const issueLinks = [...new Map(article.placements.map(({ page }) => [page.issue.id, page.issue])).values()];

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/articles">← All articles</Link>
          <p className="eyebrow">EDITORIAL</p>
          <h1>{article.title}</h1>
          {article.sourceSubmission ? (
            <p className="muted">Created from <Link className="text-link" href={`/submissions/${article.sourceSubmission.id}`}>{article.sourceSubmission.title}</Link></p>
          ) : null}
        </div>
        <div className="page-heading-actions">
          {canEdit && editorAgent?.enabled ? (
            <AgentPromptButton
              agentSlug="editor"
              apiPath={`/api/articles/${article.id}/enhance`}
              buttonLabel="Enhance"
              description="The Copywriter drafts a print-ready version of the article with subheadings, emphasis, lists and quotes, sized to the number of pages you choose. Facts are never invented. The article changes only if you accept the revision on the task page."
              dialogTitle="Enhance the article"
              pageLength={{ defaultPages: DEFAULT_ARTICLE_PAGES, wordsPerPage: ARTICLE_WORDS_PER_PAGE }}
              placeholder="Anything the Copywriter should change, keep, or emphasize…"
              startLabel="Draft revision"
              suggestions={["Keep the original headline", "Add a short event-details list", "Only tighten and format, keep the wording"]}
            />
          ) : null}
          {canPromote ? (
            <ArticlePromoteButton
              articleId={article.id}
              businessName={business?.name ?? null}
              disabledReason={promoteDisabledReason}
              issues={promoteIssueOptions}
              maxInstructions={MAX_PROMOTION_INSTRUCTIONS}
            />
          ) : null}
          {canSubmitReview ? (
            <SubmitReviewButton
              apiPath={`/api/articles/${article.id}/submit-review`}
              disabled={!business?.email || reviewOpen}
            />
          ) : null}
        </div>
      </div>
      {canEdit ? (
        <section className="panel" style={{ marginBottom: "1.5rem" }}>
          <form action={updateArticleStatus} className="business-form" style={{ padding: "0.5rem 1rem" }}>
            <input name="id" type="hidden" value={article.id} />
            <div className="review-status">
              <div aria-label="Review status" className="review-status-options" role="radiogroup">
                {[
                  ["DRAFT", "Draft"],
                  ["IN_REVIEW", "In review"],
                  ["ACCEPTED", "Accepted"],
                  ["PUBLISHED", "Published"],
                ].map(([value, label]) => (
                  <label className={`review-status-option review-status-${value.toLowerCase()}`} key={value}>
                    <input defaultChecked={article.status === value} name="status" type="radio" value={value} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button className="button button-small" type="submit">Update status</button>
            </div>
          </form>
        </section>
      ) : null}
      <ArticleEditor
          article={{
            id: article.id,
            title: article.title,
            body: article.body,
            status: article.status,
            issueIds: article.issues.map(({ issueId }) => issueId),
            images: article.images,
            businessId: article.businessId,
            promotionPackageId: article.promotionPackageId,
            costCents: article.costCents,
          }}
          businesses={businesses}
          canEdit={canEdit}
          canViewImageDetail={canEdit}
          issues={issues}
          promotionStyles={promotionStyles}
        />
      <section className="panel article-issues-panel">
        <div className="panel-heading"><h2>Issue placements <span className="count-badge">{issueLinks.length}</span></h2></div>
        {issueLinks.length ? (
          <div className="activity-list">
            {issueLinks.map((issue) => (
              <Link className="activity-row" href={`/issues/${issue.id}`} key={issue.id}>
                <span className="activity-symbol symbol-orange">I</span>
                <span className="activity-main">
                  <strong>{issue.publication.name} · {issue.publicationDate.toISOString().slice(0, 10)}</strong>
                  <span>Issue status: {issue.status.toLowerCase()}</span>
                </span>
              </Link>
            ))}
          </div>
        ) : <div className="empty-state">This article has not been placed in an issue yet.</div>}
      </section>
    </>
  );
}
