import { Suspense } from "react";
import Link from "next/link";
import { UserRole } from "@prisma/client";
import { getArticleScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { RecordDeleteScope, RecordSelectCell, RecordSelectHead } from "@/components/record-delete";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

const SORT_OPTIONS = [
  { label: "Updated", value: "updatedAt" },
  { label: "Title", value: "title" },
  { label: "Status", value: "status" },
];

export default async function ArticlesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const baseWhere = await getArticleScope(user);

  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "updatedAt", "desc");

  const where = {
    ...baseWhere,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { issues: { some: { issue: { name: { contains: q, mode: "insensitive" as const } } } } },
            { issues: { some: { issue: { publication: { name: { contains: q, mode: "insensitive" as const } } } } } },
          ],
        }
      : {}),
  };

  const orderBy =
    sort === "title" ? [{ title: order }]
    : sort === "status" ? [{ status: order }, { updatedAt: "desc" as const }]
    : [{ updatedAt: order }];

  const [articles, total] = await Promise.all([
    prisma.article.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        sourceSubmission: { select: { id: true } },
        issues: { select: { issue: { select: { name: true, publication: { select: { name: true } } } } } },
        _count: { select: { images: true } },
      },
    }),
    prisma.article.count({ where }),
  ]);
  const canCreate = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EDITORIAL WORKFLOW</p>
          <h1>Articles</h1>
          <p className="muted">Write original stories or develop accepted submissions for publication.</p>
        </div>
        {canCreate ? <Link className="button button-primary" href="/articles/new">Create article</Link> : null}
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>All articles <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="updatedAt" defaultOrder="desc" />
        </Suspense>
        {articles.length ? (
          <RecordDeleteScope
            apiBase="/api/articles"
            bulk={user.role === UserRole.ADMIN}
            ids={articles.map((article) => article.id)}
            noun="article"
          >
          <div className="table-wrap">
            <table>
              <thead><tr><RecordSelectHead bulk={user.role === UserRole.ADMIN} /><th>Article</th><th>Issues</th><th>Status</th><th>Images</th><th>Updated</th></tr></thead>
              <tbody>
                {articles.map((article) => (
                  <tr key={article.id}>
                    <RecordSelectCell id={article.id} label={article.title} />
                    <td className="table-primary">
                      <Link className="text-link" href={`/articles/${article.id}`}>{article.title}</Link>
                      {article.sourceSubmission ? <span className="article-origin">From submission</span> : null}
                    </td>
                    <td>{article.issues.map(({ issue }) => `${issue.publication.name} · ${issue.name}`).join(", ") || "—"}</td>
                    <td><span className="status-pill">{formatStatus(article.status)}</span></td>
                    <td>{article._count.images}</td>
                    <td>{article.updatedAt.toLocaleDateString()}</td>
</tr>
                ))}
              </tbody>
            </table>
          </div>
          </RecordDeleteScope>
        ) : (
          <div className="empty-state">{q ? `No articles match "${q}".` : "No articles are available yet. Accept a submission and push it to Articles, or create an article from scratch."}</div>
        )}
        <Suspense>
          <ListPagination total={total} page={page} limit={limit} />
        </Suspense>
      </section>
    </>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase().replace("_", " ");
}
