import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { ArticleEditor } from "@/components/article-editor";
import { updateArticleStatus } from "@/app/actions/content";
import { PromotionDealPanel } from "@/components/promotion-deal-panel";
import { ReviewButton } from "@/components/review-button";
import { SubmitReviewButton } from "@/components/submit-review-button";
import { getArticleScope, listIssueOptions } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLatestPromotionDeal } from "@/lib/promotion-deals";

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
        select: { id: true, originalName: true, caption: true, mimeType: true, size: true },
      },
      issues: {
        select: { issueId: true, issue: { select: { name: true, publication: { select: { name: true } } } } },
      },
      business: { select: { id: true, name: true, email: true } },
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
  const [editorAgent, marketerAgent, promotionDeal] = canEdit
    ? await Promise.all([
        prisma.agent.findUnique({ where: { slug: "editor" }, select: { id: true, enabled: true } }),
        prisma.agent.findUnique({ where: { slug: "marketer" }, select: { enabled: true } }),
        getLatestPromotionDeal({ articleId: article.id }),
      ])
    : [null, null, null];
  const reviewOpen = promotionDeal?.agentTask.status === "RUNNING" || promotionDeal?.agentTask.status === "PENDING";
  const [issues, businesses] = await Promise.all([
    canEdit
      ? listIssueOptions(user)
      : Promise.resolve(
          article.issues.map(({ issueId, issue }) => ({
            id: issueId,
            name: `${issue.publication.name} · ${issue.name}`,
          })),
        ),
    canEdit
      ? prisma.business.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);
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
            <ReviewButton
              apiPath={`/api/articles/${article.id}/review`}
            />
          ) : null}
          {canEdit && marketerAgent?.enabled ? (
            <SubmitReviewButton
              apiPath={`/api/articles/${article.id}/submit-review`}
              disabled={!article.business?.email || reviewOpen}
            />
          ) : null}
          {canEdit ? (
            <form action={updateArticleStatus} className="inline-edit">
              <input name="id" type="hidden" value={article.id} />
              <select aria-label="Article status" defaultValue={article.status} name="status">
                <option value="DRAFT">Draft</option>
                <option value="ACCEPTED">Accepted</option>
                <option value="PUBLISHED">Published</option>
              </select>
              <button className="button button-small" type="submit">Save status</button>
            </form>
          ) : <span className="status-pill">{article.status.toLowerCase()}</span>}
        </div>
      </div>
      <section className="panel article-edit-panel">
        <ArticleEditor
          article={{
            id: article.id,
            title: article.title,
            body: article.body,
            status: article.status,
            issueIds: article.issues.map(({ issueId }) => issueId),
            images: article.images,
            businessId: article.businessId,
          }}
          businesses={businesses}
          canEdit={canEdit}
          canViewImageDetail={canEdit}
          issues={issues}
        />
      </section>
      {canEdit ? (
        <PromotionDealPanel
          businessEmail={article.business?.email ?? null}
          businessName={article.business?.name ?? null}
          deal={promotionDeal}
          kind="article"
          showConversationLink={user.role === UserRole.ADMIN}
        />
      ) : null}
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
