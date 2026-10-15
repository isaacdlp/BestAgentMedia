import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { UserRole } from "@prisma/client";
import { getPublicationScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { RecordDeleteScope, RecordSelectCell, RecordSelectHead } from "@/components/record-delete";
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
  if (user.role !== UserRole.ADMIN && user.role !== UserRole.EDITOR) redirect("/dashboard");

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
        zipCodes: { select: { estimatedPopulation: true, areaSquareMiles: true } },
        _count: { select: { submissions: true } },
      },
    }),
    prisma.publication.count({ where }),
  ]);
  const advertisementCounts = await Promise.all(
    publications.map(({ id }) =>
      prisma.advertisement.count({ where: { issues: { some: { issue: { publicationId: id } } } } }),
    ),
  );

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
          <RecordDeleteScope
            apiBase="/api/publications"
            bulk={user.role === UserRole.ADMIN}
            ids={publications.map((publication) => publication.id)}
            noun="publication"
          >
          <div className="table-wrap">
            <table>
              <thead>
                <tr><RecordSelectHead bulk={user.role === UserRole.ADMIN} /><th>Publication</th><th>Zip Count</th><th>Distribution</th><th>Area</th><th>Submissions</th><th>Ads</th></tr>
              </thead>
              <tbody>
                {publications.map((publication, index) => (
                  <tr key={publication.id}>
                    <RecordSelectCell id={publication.id} label={publication.name} />
                    <td className="table-primary">
                      <Link className="text-link" href={`/publications/${publication.id}`}>{publication.name}</Link>
                    </td>
                    <td>{publication.zipCodes.length}</td>
                    <td>{formatPopulation(publication.zipCodes)}</td>
                    <td>{formatArea(publication.zipCodes)}</td>
                    <td>{publication._count.submissions}</td>
                    <td>{advertisementCounts[index]}</td>
</tr>
                ))}
              </tbody>
            </table>
          </div>
          </RecordDeleteScope>
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

type ZipMetrics = { estimatedPopulation: number | null; areaSquareMiles: number | null };

function formatPopulation(zipCodes: ZipMetrics[]) {
  if (!zipCodes.length) return "—";
  const total = zipCodes.reduce((sum, zip) => sum + (zip.estimatedPopulation ?? 0), 0);
  return total.toLocaleString("en-US");
}

function formatArea(zipCodes: ZipMetrics[]) {
  if (!zipCodes.length) return "—";
  const total = zipCodes.reduce((sum, zip) => sum + (zip.areaSquareMiles ?? 0), 0);
  return `${total.toLocaleString("en-US", { maximumFractionDigits: 1 })} sq mi`;
}
