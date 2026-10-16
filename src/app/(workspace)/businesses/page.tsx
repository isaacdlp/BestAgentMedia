import { Suspense } from "react";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import Link from "next/link";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { RecordDeleteScope, RecordSelectCell, RecordSelectHead } from "@/components/record-delete";
import { TaskAutoRefresh } from "@/components/task-auto-refresh";
import { requireUser } from "@/lib/auth";
import { getBusinessScope } from "@/lib/access";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

const SORT_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "City", value: "city" },
  { label: "Category", value: "category" },
];

export default async function BusinessesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const baseWhere = getBusinessScope(user);
  if (!baseWhere) redirect("/dashboard");

  const isAdmin = user.role === UserRole.ADMIN;
  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "name", "asc");

  const publicationIdParam = Number(Array.isArray(sp.publicationId) ? sp.publicationId[0] : sp.publicationId);
  const publicationId = Number.isInteger(publicationIdParam) && publicationIdParam > 0 ? publicationIdParam : null;
  const filteredPublication = publicationId
    ? await prisma.publication.findUnique({
        where: { id: publicationId },
        select: { name: true, zipCodes: { select: { code: true } } },
      })
    : null;
  const scopedWhere = filteredPublication
    ? {
        AND: [
          baseWhere,
          { postalCode: { in: filteredPublication.zipCodes.map(({ code }) => code) } },
        ],
      }
    : baseWhere;

  const where = q
    ? {
        ...scopedWhere,
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { primaryCategory: { contains: q, mode: "insensitive" as const } },
          { city: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
          { postalCode: { contains: q } },
          { stateCode: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : scopedWhere;

  const orderBy =
    sort === "city"
      ? [{ city: order }, { name: "asc" as const }]
      : sort === "category"
        ? [{ primaryCategory: order }, { name: "asc" as const }]
        : [{ name: order }];

  const [businesses, total] = await Promise.all([
    prisma.business.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        primaryCategory: true,
        addressLabel: true,
        city: true,
        stateCode: true,
        postalCode: true,
        phone: true,
        email: true,
        website: true,
      },
    }),
    prisma.business.count({ where }),
  ]);

  return (
    <>
      <TaskAutoRefresh active={false} />
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>Businesses</h1>
          <p className="muted">
            {filteredPublication
              ? `Businesses in the ZIP codes covered by ${filteredPublication.name}.`
              : "Businesses identified as potential local advertisers."}
            {filteredPublication ? <> <Link className="text-link" href="/businesses">Show all</Link></> : null}
          </p>
        </div>
        <div className="page-heading-actions">
          <span className="role-pill">{total} businesses</span>
          {isAdmin ? <Link className="button button-secondary" href="/businesses/import/new">Import</Link> : null}
          {isAdmin ? <Link className="button button-secondary" href="/businesses/reachout/new">Onboard</Link> : null}
          {isAdmin ? <Link className="button button-secondary" href="/businesses/promote/new">Promote</Link> : null}
          {isAdmin ? <Link className="button button-primary" href="/businesses/new">Create business</Link> : null}
        </div>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>All businesses <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="name" defaultOrder="asc" />
        </Suspense>
        {businesses.length ? (
          <RecordDeleteScope
            apiBase="/api/businesses"
            bulk={user.role === UserRole.ADMIN}
            ids={businesses.map((business) => business.id)}
            noun="business"
          >
          <div className="table-wrap">
            <table>
              <thead>
                <tr><RecordSelectHead bulk={user.role === UserRole.ADMIN} />
                  <th>Business</th>
                  <th>Category</th>
                  <th>Location</th>
                  <th>Phone</th>
                  <th>Email</th>
                  <th>Website</th>
                </tr>
              </thead>
              <tbody>
                {businesses.map((business) => (
                  <tr key={business.id}>
                    <RecordSelectCell id={business.id} label={business.name} />
                    <td className="table-primary">
                      <Link className="text-link" href={`/businesses/${business.id}`}>
                        {business.name}
                      </Link>
                    </td>
                    <td>{business.primaryCategory ?? "—"}</td>
                    <td>
                      {[business.city, business.stateCode, business.postalCode].filter(Boolean).join(", ") || "—"}
                    </td>
                    <td>{business.phone ?? "—"}</td>
                    <td>
                      {business.email ? (
                        <a className="text-link" href={`mailto:${business.email}`}>{business.email}</a>
                      ) : "—"}
                    </td>
                    <td>
                      {business.website ? (
                        <a className="text-link" href={business.website} rel="noreferrer" target="_blank">Visit website</a>
                      ) : "—"}
                    </td>
</tr>
                ))}
              </tbody>
            </table>
          </div>
          </RecordDeleteScope>
        ) : (
          <div className="empty-state">{q ? `No businesses match "${q}".` : "No businesses yet."}</div>
        )}
        <Suspense>
          <ListPagination total={total} page={page} limit={limit} />
        </Suspense>
      </section>
    </>
  );
}
