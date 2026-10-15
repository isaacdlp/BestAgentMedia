import Link from "next/link";
import { Suspense } from "react";
import { UserRole } from "@prisma/client";
import { updateAdvertisementStatus } from "@/app/actions/records";
import { getAdvertisementScope } from "@/lib/access";
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

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const baseWhere = await getAdvertisementScope(user);

  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "updatedAt", "desc");

  const where = {
    ...baseWhere,
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" as const } },
            { business: { name: { contains: q, mode: "insensitive" as const } } },
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

  const [ads, total] = await Promise.all([
    prisma.advertisement.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        title: true,
        status: true,
        updatedAt: true,
        business: { select: { id: true, name: true } },
        issues: { select: { issue: { select: { name: true, publication: { select: { name: true } } } } } },
      },
    }),
    prisma.advertisement.count({ where }),
  ]);
  const canManage = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADVERTISING</p>
          <h1>Advertisements</h1>
          <p className="muted">Track ad submissions and publication status.</p>
        </div>
        {canManage ? (
          <div className="page-heading-actions">
            <Link className="button button-primary" href="/ads/new">Create ad</Link>
          </div>
        ) : null}
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>All ads <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="updatedAt" defaultOrder="desc" />
        </Suspense>
        {ads.length ? (
          <RecordDeleteScope
            apiBase="/api/ads"
            bulk={user.role === UserRole.ADMIN}
            ids={ads.map((ad) => ad.id)}
            noun="ad"
          >
          <div className="table-wrap">
            <table>
              <thead>
                <tr><RecordSelectHead bulk={user.role === UserRole.ADMIN} />
                  <th>Ad</th>
                  <th>Business</th>
                  <th>Issues</th>
                  <th>Status</th>
                  <th>Updated</th>
                  {canManage ? <th>Review</th> : null}
                </tr>
              </thead>
              <tbody>
                {ads.map((ad) => (
                  <tr key={ad.id}>
                    <RecordSelectCell id={ad.id} label={ad.title} />
                    <td className="table-primary">
                      <Link className="text-link" href={`/ads/${ad.id}`}>{ad.title}</Link>
                    </td>
                    <td>
                      <Link className="text-link" href={`/businesses/${ad.business.id}`}>{ad.business.name}</Link>
                    </td>
                    <td>{ad.issues.map(({ issue }) => `${issue.publication.name} · ${issue.name}`).join(", ") || "—"}</td>
                    <td><span className="status-pill">{formatStatus(ad.status)}</span></td>
                    <td>{ad.updatedAt.toLocaleDateString()}</td>
                    {canManage ? (
                      <td>
                        <form action={updateAdvertisementStatus} className="inline-edit">
                          <input name="id" type="hidden" value={ad.id} />
                          <select aria-label={`Update ${ad.title} status`} defaultValue={ad.status} name="status">
                            <option value="DRAFT">Draft</option>
                            <option value="IN_REVIEW">In review</option>
                            <option value="APPROVED">Approved</option>
                            <option value="PUBLISHED">Published</option>
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
          </RecordDeleteScope>
        ) : (
          <div className="empty-state">{q ? `No ads match "${q}".` : "No advertisements are available yet."}</div>
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
