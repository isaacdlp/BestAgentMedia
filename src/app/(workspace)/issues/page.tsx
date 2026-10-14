import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { createIssue } from "@/app/actions/content";
import { getIssueScope, getPublicationScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

const SORT_OPTIONS = [
  { label: "Date", value: "publicationDate" },
  { label: "Status", value: "status" },
];

export default async function IssuesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const baseWhere = await getIssueScope(user);
  if (!baseWhere) redirect("/dashboard");

  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "publicationDate", "desc");

  const where = {
    ...baseWhere,
    ...(q
      ? { publication: { name: { contains: q, mode: "insensitive" as const } } }
      : {}),
  };

  const orderBy =
    sort === "status"
      ? [{ status: order }, { publicationDate: "desc" as const }]
      : [{ publicationDate: order }, { publication: { name: "asc" as const } }];

  const [publicationScope, [issues, total]] = await Promise.all([
    getPublicationScope(user),
    Promise.all([
      prisma.issue.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          publicationDate: true,
          status: true,
          publication: { select: { name: true } },
          _count: { select: { pages: true } },
        },
      }),
      prisma.issue.count({ where }),
    ]),
  ]);

  const publications = publicationScope
    ? await prisma.publication.findMany({
        where: publicationScope,
        orderBy: { name: "asc" },
        select: { id: true, name: true },
      })
    : [];
  const canManage = user.role === UserRole.ADMIN || user.role === UserRole.PUBLISHER;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PUBLICATION WORKFLOW</p>
          <h1>Issues</h1>
          <p className="muted">Plan releases and arrange articles and advertisements on each page.</p>
        </div>
      </div>
      {canManage ? (
        <section className="panel issue-create-panel">
          <div className="panel-heading"><h2>Create an issue</h2></div>
          <form action={createIssue} className="inline-edit issue-create-form">
            <label className="business-field">
              <span>Publication</span>
              <select name="publicationId" required>
                <option value="">Choose publication</option>
                {publications.map((publication) => (
                  <option key={publication.id} value={publication.id}>{publication.name}</option>
                ))}
              </select>
            </label>
            <label className="business-field">
              <span>Publication date</span>
              <input defaultValue={new Date().toISOString().slice(0, 10)} name="publicationDate" required type="date" />
            </label>
            <button className="button button-primary" type="submit">Create issue</button>
          </form>
        </section>
      ) : null}
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>All issues <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="publicationDate" defaultOrder="desc" />
        </Suspense>
        {issues.length ? (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Publication</th><th>Publication date</th><th>Status</th><th>Pages</th></tr></thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.id}>
                    <td className="table-primary"><Link className="text-link" href={`/issues/${issue.id}`}>{issue.publication.name}</Link></td>
                    <td>{issue.publicationDate.toISOString().slice(0, 10)}</td>
                    <td><span className="status-pill">{formatStatus(issue.status)}</span></td>
                    <td>{issue._count.pages}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">{q ? `No issues match "${q}".` : "No issues have been created yet."}</div>
        )}
        <Suspense>
          <ListPagination total={total} page={page} limit={limit} />
        </Suspense>
      </section>
    </>
  );
}

function formatStatus(status: string) {
  return status.toLowerCase();
}
