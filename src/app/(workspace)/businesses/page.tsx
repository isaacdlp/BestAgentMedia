import { Suspense } from "react";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import Link from "next/link";
import { BusinessesSectionNav } from "@/components/businesses-section-nav";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
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

  const where = q
    ? {
        ...baseWhere,
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { primaryCategory: { contains: q, mode: "insensitive" as const } },
          { city: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : baseWhere;

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
      <div className="page-heading">
        <div>
          <p className="eyebrow">BUSINESS DEVELOPMENT</p>
          <h1>Businesses</h1>
          <p className="muted">Businesses identified as potential local advertisers.</p>
        </div>
        <div className="page-heading-actions">
          <span className="role-pill">{total} businesses</span>
          {isAdmin ? <Link className="button button-primary" href="/businesses/new">Create business</Link> : null}
        </div>
      </div>
      {isAdmin ? <BusinessesSectionNav current="businesses" /> : null}
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>All businesses <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="name" defaultOrder="asc" />
        </Suspense>
        {businesses.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
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
