import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { UserRole } from "@prisma/client";
import { updateSubmissionStatus } from "@/app/actions/records";
import { requireUser } from "@/lib/auth";
import { getSubmissionScope } from "@/lib/access";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

const SORT_OPTIONS = [
  { label: "Updated", value: "updatedAt" },
  { label: "Title", value: "title" },
  { label: "Status", value: "status" },
];

export default async function SubmissionsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const baseWhere = await getSubmissionScope(user);
  if (!baseWhere) redirect("/dashboard");

  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "updatedAt", "desc");

  const where = {
    ...baseWhere,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { submitterName: { contains: q, mode: "insensitive" as const } },
          ],
        }
      : {}),
  };

  const orderBy =
    sort === "title" ? [{ title: order }]
    : sort === "status" ? [{ status: order }, { updatedAt: "desc" as const }]
    : [{ updatedAt: order }];

  const [submissions, total] = await Promise.all([
    prisma.contentSubmission.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        submitterName: true,
        status: true,
        updatedAt: true,
        publication: { select: { name: true } },
      },
    }),
    prisma.contentSubmission.count({ where }),
  ]);
  const canManage = user.role === UserRole.ADMIN || user.role === UserRole.PUBLISHER;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">EDITORIAL</p>
          <h1>Content submissions</h1>
          <p className="muted">Track submitted stories and their review status.</p>
        </div>
        <Link className="button button-primary" href="/submit-content">Create submission</Link>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>All submissions <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="updatedAt" defaultOrder="desc" />
        </Suspense>
        {submissions.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Story</th><th>Publication</th><th>Submitted by</th><th>Status</th><th>Updated</th>{canManage ? <th>Review</th> : null}</tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr key={submission.id}>
                    <td className="table-primary">
                      <Link className="text-link" href={`/submissions/${submission.id}`}>{submission.title}</Link>
                    </td>
                    <td>{submission.publication.name}</td>
                    <td>{submission.submitterName ?? "—"}</td>
                    <td><span className="status-pill">{formatStatus(submission.status)}</span></td>
                    <td>{submission.updatedAt.toLocaleDateString()}</td>
                    {canManage ? (
                      <td>
                        <form action={updateSubmissionStatus} className="inline-edit">
                          <input name="id" type="hidden" value={submission.id} />
                          <select aria-label={`Update ${submission.title} status`} defaultValue={submission.status} name="status">
                            <option value="NEW">New</option>
                            <option value="IN_REVIEW">In review</option>
                            <option value="NEEDS_INFORMATION">Needs information</option>
                            <option value="ACCEPTED">Accepted</option>
                            <option value="DECLINED">Declined</option>
                          </select>
                          <button className="button button-small" type="submit">Save</button>
                        </form>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">{q ? `No submissions match "${q}".` : "No content submissions are available yet."}</div>
        )}
        <Suspense>
          <ListPagination total={total} page={page} limit={limit} />
        </Suspense>
      </section>
    </>
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}
