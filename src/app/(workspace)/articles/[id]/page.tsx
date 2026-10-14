import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { ArticleEditor } from "@/components/article-editor";
import { updateArticleStatus } from "@/app/actions/content";
import { ReviewButton } from "@/components/review-button";
import { getArticleScope, getPublicationScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

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
      publications: {
        orderBy: { publication: { name: "asc" } },
        select: { publicationId: true, publication: { select: { name: true } } },
      },
      business: { select: { id: true, name: true } },
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

  const canEdit = user.role === UserRole.ADMIN || user.role === UserRole.PUBLISHER;
  const editorAgent = canEdit
    ? await prisma.agent.findUnique({ where: { slug: "editor" }, select: { id: true, enabled: true } })
    : null;
  const publicationScope = canEdit ? await getPublicationScope(user) : null;
  const [publications, businesses] = await Promise.all([
    canEdit && publicationScope
      ? prisma.publication.findMany({
          where: publicationScope,
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve(
          article.publications.map(({ publicationId, publication }) => ({
            id: publicationId,
            name: publication.name,
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
              agentPath={`/agents/${editorAgent.id}`}
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
            publicationIds: article.publications.map(({ publicationId }) => publicationId),
            images: article.images,
            businessId: article.businessId,
          }}
          businesses={businesses}
          canEdit={canEdit}
          canViewImageDetail={canEdit}
          publications={publications}
        />
      </section>
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
