import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { RecordDeleteScope, RecordSelectCell, RecordSelectHead } from "@/components/record-delete";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

const SORT_OPTIONS = [
  { label: "Name", value: "name" },
  { label: "Email", value: "email" },
  { label: "Role", value: "role" },
  { label: "Created", value: "createdAt" },
];

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrator",
  EDITOR: "Editor",
  CONTRIBUTOR: "Contributor",
};

export default async function UsersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) redirect("/dashboard");

  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "name", "asc");

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { surname: { contains: q, mode: "insensitive" as const } },
          { email: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const orderBy =
    sort === "email" ? [{ email: order }]
    : sort === "role" ? [{ role: order }, { name: "asc" as const }]
    : sort === "createdAt" ? [{ createdAt: order }]
    : [{ name: order }, { email: "asc" as const }];

  const [users, total] = await Promise.all([
    prisma.user.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        surname: true,
        email: true,
        role: true,
        active: true,
        createdAt: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Users</h1>
          <p className="muted">Review workspace accounts and publication access.</p>
        </div>
        <span className="role-pill">{total} users</span>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>All users <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="name" defaultOrder="asc" />
        </Suspense>
        {users.length ? (
          <RecordDeleteScope
            apiBase="/api/users"
            bulk={user.role === UserRole.ADMIN}
            ids={users.map((account) => account.id)}
            noun="user"
          >
          <div className="table-wrap">
            <table>
              <thead>
                <tr><RecordSelectHead bulk={user.role === UserRole.ADMIN} />
                  <th>Name</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {users.map((account) => (
                  <tr key={account.id}>
                    <RecordSelectCell id={account.id} label={[account.name, account.surname].filter(Boolean).join(" ")} />
                    <td className="table-primary">
                      <Link className="text-link" href={`/users/${account.id}`}>
                        {[account.name, account.surname].filter(Boolean).join(" ")}
                      </Link>
                    </td>
                    <td><a className="text-link" href={`mailto:${account.email}`}>{account.email}</a></td>
                    <td>{account.role ? roleLabels[account.role] : "Contributor"}</td>
                    <td><span className="status-pill">{account.active ? "Active" : "Inactive"}</span></td>
                    <td>{account.createdAt.toLocaleDateString()}</td>
</tr>
                ))}
              </tbody>
            </table>
          </div>
          </RecordDeleteScope>
        ) : (
          <div className="empty-state">{q ? `No users match "${q}".` : "No users have been added yet."}</div>
        )}
        <Suspense>
          <ListPagination total={total} page={page} limit={limit} />
        </Suspense>
      </section>
    </>
  );
}
