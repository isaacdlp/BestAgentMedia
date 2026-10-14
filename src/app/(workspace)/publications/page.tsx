import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { UserRole } from "@prisma/client";
import { getPublicationScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

const SORT_OPTIONS = [
  { label: "Name", value: "name" },
];

export default async function PublicationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.PUBLISHER) redirect("/dashboard");

  const baseWhere = await getPublicationScope(user);
  if (!baseWhere) redirect("/dashboard");

  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "name", "asc");

  const where = {
    ...baseWhere,
    ...(q ? { name: { contains: q, mode: "insensitive" as const } } : {}),
  };

  const [publications, total] = await Promise.all([
    prisma.publication.findMany({
      where,
      orderBy: [{ [sort || "name"]: order }],
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        zipCodes: { select: { code: true }, orderBy: { code: "asc" } },
        _count: { select: { submissions: true, advertisements: true } },
      },
    }),
    prisma.publication.count({ where }),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">PUBLICATIONS</p>
          <h1>Publications</h1>
          <p className="muted">Publications available in your workspace.</p>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>All publications <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="name" defaultOrder="asc" />
        </Suspense>
        {publications.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Publication</th><th>ZIP codes</th><th>Submissions</th><th>Ads</th></tr>
              </thead>
              <tbody>
                {publications.map((publication) => (
                  <tr key={publication.id}>
                    <td className="table-primary">
                      <Link className="text-link" href={`/publications/${publication.id}`}>{publication.name}</Link>
                    </td>
                    <td>{publication.zipCodes.map(({ code }) => code).join(", ") || "—"}</td>
                    <td>{publication._count.submissions}</td>
                    <td>{publication._count.advertisements}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty-state">{q ? `No publications match "${q}".` : "No publications are assigned to this workspace yet."}</div>
        )}
        <Suspense>
          <ListPagination total={total} page={page} limit={limit} />
        </Suspense>
      </section>
    </>
  );
}
