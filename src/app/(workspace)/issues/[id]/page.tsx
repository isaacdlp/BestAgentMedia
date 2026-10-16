import { UserRole } from "@prisma/client";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { updateIssueDetails, updateIssueStatus } from "@/app/actions/content";
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
          { issues: { some: { issueId: issue.id } } },
          { status: { in: ["ACCEPTED", "PUBLISHED"] } },
        ],
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        body: true,
        images: {
          orderBy: { position: "asc" },
          select: { id: true },
        },
      },
    }),
    prisma.advertisement.findMany({
      where: {
        issues: { some: { issueId: issue.id } },
        status: { in: ["APPROVED", "PUBLISHED"] },
      },
      orderBy: { title: "asc" },
      select: {
        id: true,
        title: true,
        creativeFileName: true,
        business: { select: { name: true } },
      },
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
        {user.role === UserRole.ADMIN ? (
          <div className="page-heading-actions">
            <Link className="button button-primary" href={`/businesses/promote/new?issue=${encodeURIComponent(issue.id)}`}>
              Promote
            </Link>
          </div>
        ) : null}
      </div>
      {canManage ? (
        <section className="panel">
          <form action={updateIssueStatus} className="business-form" style={{ padding: "0.5rem 1rem" }}>
            <input name="id" type="hidden" value={issue.id} />
            <div className="review-status">
              <div aria-label="Issue status" className="review-status-options" role="radiogroup">
                {[
                  ["DRAFT", "Draft"],
                  ["IN_REVIEW", "In review"],
                  ["ACCEPTED", "Accepted"],
                  ["PUBLISHED", "Published"],
                ].map(([value, label]) => (
                  <label className={`review-status-option review-status-${value.toLowerCase()}`} key={value}>
                    <input defaultChecked={issue.status === value} name="status" type="radio" value={value} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button className="button button-small" type="submit">Update status</button>
            </div>
          </form>
        </section>
      ) : null}
      {canManage ? (
        <IssuePageEditor
          advertisements={advertisements.map((ad) => ({
            id: ad.id,
            title: ad.title,
            type: "advertisement" as const,
            description: ad.business.name,
            imageUrl: ad.creativeFileName ? `/api/ads/${ad.id}/creative` : undefined,
          }))}
          articles={articles.map((article) => ({
            id: article.id,
            title: article.title,
            type: "article" as const,
            description: article.body,
            imageUrl: article.images[0]
              ? `/api/articles/${article.id}/images/${article.images[0].id}`
              : undefined,
            imageUrls: article.images.map((image) => `/api/articles/${article.id}/images/${image.id}`),
          }))}
          design={design}
          issueId={issue.id}
          publicationDate={issue.publicationDate.toISOString()}
          publicationName={issue.publication.name}
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
      {canManage ? (
        <section className="panel" style={{ marginTop: "2rem" }}>
          <div className="panel-heading">
            <h2>Issue details</h2>
          </div>
          <form action={updateIssueDetails} className="business-form">
            <input name="id" type="hidden" value={issue.id} />
            <div className="business-form-grid">
              <label className="business-field business-field-wide">
                <span>Name <span aria-hidden="true">*</span></span>
                <input defaultValue={issue.name} name="name" required type="text" />
              </label>
              <label className="business-field">
                <span>Slug <span aria-hidden="true">*</span></span>
                <input defaultValue={issue.slug} name="slug" pattern="[a-z0-9]+(-[a-z0-9]+)*" required type="text" />
              </label>
              <label className="business-field">
                <span>Publication date <span aria-hidden="true">*</span></span>
                <input
                  defaultValue={issue.publicationDate.toISOString().slice(0, 10)}
                  name="publicationDate"
                  required
                  type="date"
                />
              </label>
              <label className="business-field business-field-wide">
                <span>Description</span>
                <textarea defaultValue={issue.description ?? ""} name="description" rows={3} />
              </label>
            </div>
            <div className="business-form-footer">
              <p className="muted">Record ID: {issue.id}</p>
              <button className="button button-primary" type="submit">Save changes</button>
            </div>
          </form>
        </section>
      ) : null}
    </div>
  );
}
