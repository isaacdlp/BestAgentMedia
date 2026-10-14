import { UserRole } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { updateIssueDetails } from "@/app/actions/content";
import { IssuePageEditor } from "@/components/issue-page-editor-loader";
import { getArticleScope, getIssueScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function IssueDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await requireUser();
  const scope = await getIssueScope(user);
  if (!scope) redirect("/dashboard");
  const { id } = await params;
  if (!/^[\w-]{1,64}$/.test(id)) notFound();

  const issue = await prisma.issue.findFirst({
    where: { id, ...scope },
    include: {
      publication: { select: { id: true, name: true } },
      pages: {
        orderBy: { pageNumber: "asc" },
        select: {
          id: true,
          pageNumber: true,
          type: true,
          placements: { select: { id: true } },
        },
      },
    },
  });
  if (!issue) notFound();

  const articleScope = await getArticleScope(user);
  const [articles, advertisements] = await Promise.all([
    prisma.article.findMany({
      where: {
        AND: [
          articleScope,
          { publications: { some: { publicationId: issue.publicationId } } },
        ],
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        body: true,
        images: {
          orderBy: { position: "asc" },
          select: { id: true, caption: true },
        },
      },
    }),
    prisma.advertisement.findMany({
      where: {
        publications: { some: { publicationId: issue.publicationId } },
        status: { not: "DECLINED" },
      },
      orderBy: { title: "asc" },
      select: { id: true, title: true, business: { select: { name: true } } },
    }),
  ]);
  const canManage = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;
  const design =
    typeof issue.designJson === "object" &&
    issue.designJson !== null &&
    !Array.isArray(issue.designJson)
      ? (issue.designJson as Record<string, unknown>)
      : null;

  return (
    <div className="issue-detail">
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/issues">← All issues</Link>
          <p className="eyebrow">ISSUE · {issue.publication.name}</p>
          <h1>{issue.name}</h1>
          {issue.description ? <p className="muted">{issue.description}</p> : null}
          <p className="muted">Publication date: {issue.publicationDate.toISOString().slice(0, 10)}</p>
        </div>
        {canManage ? (
          <form action={updateIssueDetails} className="inline-edit issue-detail-form">
            <input name="id" type="hidden" value={issue.id} />
            <label>
              <span>Name</span>
              <input defaultValue={issue.name} name="name" required type="text" />
            </label>
            <label>
              <span>Slug</span>
              <input defaultValue={issue.slug} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required type="text" />
            </label>
            <label>
              <span>Description</span>
              <textarea defaultValue={issue.description ?? ""} name="description" rows={2} />
            </label>
            <label>
              <span>Publication date</span>
              <input
                defaultValue={issue.publicationDate.toISOString().slice(0, 10)}
                name="publicationDate"
                required
                type="date"
              />
            </label>
            <select aria-label="Issue status" defaultValue={issue.status} name="status">
              <option value="DRAFT">Draft</option>
              <option value="ACCEPTED">Accepted</option>
              <option value="PUBLISHED">Published</option>
            </select>
            <button className="button button-small" type="submit">Save details</button>
          </form>
        ) : null}
      </div>
      {canManage ? (
        <IssuePageEditor
          advertisements={advertisements.map((ad) => ({
            id: ad.id,
            title: ad.title,
            type: "advertisement" as const,
            description: ad.business.name,
          }))}
          articles={articles.map((article) => ({
            id: article.id,
            title: article.title,
            type: "article" as const,
            description: article.body,
            imageUrl: article.images[0]
              ? `/api/articles/${article.id}/images/${article.images[0].id}`
              : undefined,
          }))}
          design={design}
          issueId={issue.id}
          pages={issue.pages.map(({ id: pageId, pageNumber, type }) => ({
            id: pageId,
            pageNumber,
            type,
          }))}
        />
      ) : (
        <section className="panel">
          <h2>Issue layout</h2>
          <p className="muted">
            This issue has {issue.pages.length} pages and {issue.pages.reduce((sum, page) => sum + page.placements.length, 0)} linked content items.
          </p>
        </section>
      )}
    </div>
  );
}
