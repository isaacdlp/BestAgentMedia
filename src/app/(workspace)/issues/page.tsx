import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { getIssueScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { RecordDeleteScope, RecordSelectCell, RecordSelectHead } from "@/components/record-delete";
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

  const publicationIdParam = Number(Array.isArray(sp.publicationId) ? sp.publicationId[0] : sp.publicationId);
  const publicationId = Number.isInteger(publicationIdParam) && publicationIdParam > 0 ? publicationIdParam : null;
  const filteredPublication = publicationId
    ? await prisma.publication.findUnique({ where: { id: publicationId }, select: { name: true } })
    : null;

  const where = {
    ...baseWhere,
    ...(publicationId ? { publicationId } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { publication: { name: { contains: q, mode: "insensitive" as const } } },
          ],
        }
      : {}),
  };

  const orderBy =
    sort === "status"
      ? [{ status: order }, { publicationDate: "desc" as const }]
      : [{ publicationDate: order }, { publication: { name: "asc" as const } }];

  const [issues, total] = await Promise.all([
    prisma.issue.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        publicationDate: true,
        status: true,
        publication: { select: { name: true } },
        _count: { select: { pages: true } },
      },
    }),
    prisma.issue.count({ where }),
  ]);
  const canManage = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PUBLICATION WORKFLOW</p>
          <h1>Issues</h1>
          <p className="muted">Plan releases and arrange articles and advertisements on each page.</p>
        </div>
        {canManage ? <Link className="button button-primary" href={publicationId ? `/issues/new?publicationId=${publicationId}` : "/issues/new"}>Create issue</Link> : null}
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>
            {filteredPublication ? `Issues of ${filteredPublication.name}` : "All issues"}{" "}
            <span className="count-badge">{total}</span>
          </h2>
          {filteredPublication ? <Link className="text-link" href="/issues">Show all issues</Link> : null}
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="publicationDate" defaultOrder="desc" />
        </Suspense>
        {issues.length ? (
          <RecordDeleteScope
            apiBase="/api/issues"
            bulk={user.role === UserRole.ADMIN}
            ids={issues.map((issue) => issue.id)}
            noun="issue"
          >
          <div className="table-wrap">
            <table>
              <thead><tr><RecordSelectHead bulk={user.role === UserRole.ADMIN} /><th>Issue</th><th>Publication</th><th>Publication date</th><th>Status</th><th>Pages</th></tr></thead>
              <tbody>
                {issues.map((issue) => (
                  <tr key={issue.id}>
                    <RecordSelectCell id={issue.id} label={issue.name} />
                    <td className="table-primary"><Link className="text-link" href={`/issues/${issue.id}`}>{issue.name}</Link></td>
                    <td>{issue.publication.name}</td>
                    <td>{issue.publicationDate.toISOString().slice(0, 10)}</td>
                    <td><span className="status-pill">{formatStatus(issue.status)}</span></td>
                    <td>{issue._count.pages}</td>
</tr>
                ))}
              </tbody>
            </table>
          </div>
          </RecordDeleteScope>
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
