import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { getSubmissionScope } from "@/lib/access";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { RecordDeleteScope, RecordSelectCell, RecordSelectHead } from "@/components/record-delete";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

const STATUS_OPTIONS = [
  { label: "Draft", value: "DRAFT" },
  { label: "In review", value: "IN_REVIEW" },
  { label: "Needs information", value: "NEEDS_INFORMATION" },
  { label: "Accepted", value: "ACCEPTED" },
  { label: "Declined", value: "DECLINED" },
];

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

  const canManage = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;

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
          <RecordDeleteScope
            apiBase="/api/submissions"
            bulk={canManage}
            canDelete={user.role === UserRole.ADMIN}
            statusKind="submission"
            statusOptions={STATUS_OPTIONS}
            ids={submissions.map((submission) => submission.id)}
            noun="submission"
          >
          <div className="table-wrap">
            <table>
              <thead>
                <tr><RecordSelectHead bulk={canManage} /><th>Story</th><th>Publication</th><th>Submitted by</th><th>Status</th><th>Updated</th></tr>
              </thead>
              <tbody>
                {submissions.map((submission) => (
                  <tr key={submission.id}>
                    <RecordSelectCell id={submission.id} label={submission.title} />
                    <td className="table-primary">
                      <Link className="text-link" href={`/submissions/${submission.id}`}>{submission.title}</Link>
                    </td>
                    <td>{submission.publication.name}</td>
                    <td>{submission.submitterName ?? "—"}</td>
                    <td><span className="status-pill">{formatStatus(submission.status)}</span></td>
                    <td>{submission.updatedAt.toLocaleDateString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </RecordDeleteScope>
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
