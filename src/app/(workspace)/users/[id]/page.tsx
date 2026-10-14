import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { deleteUser, updateUser } from "@/app/actions/users";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type UserDetailPageProps = {
  params: Promise<{ id: string }>;
};

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrator",
  PUBLISHER: "Publisher",
  CONTRIBUTOR: "Contributor",
};

export default async function UserDetailPage({ params }: UserDetailPageProps) {
  const currentUser = await requireUser();
  if (currentUser.role !== UserRole.ADMIN) {
    redirect("/dashboard");
  }

  const { id } = await params;
  if (!id) {
    notFound();
  }

  const account = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      name: true,
      surname: true,
      email: true,
      phone: true,
      role: true,
      active: true,
      createdAt: true,
      updatedAt: true,
      publicationAccess: {
        orderBy: { publication: { name: "asc" } },
        select: { publication: { select: { id: true, name: true } } },
      },
      business: {
        select: { id: true, name: true },
      },
    },
  });

  if (!account) {
    notFound();
  }

  const isSelf = account.id === currentUser.id;

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/users">
            ← All users
          </Link>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>
            {account.name} {account.surname}
          </h1>
          <p className="muted">View and edit workspace account details.</p>
        </div>
        <span className="role-pill">
          {account.role ? roleLabels[account.role] : "Contributor"}
        </span>
      </div>

      <div className="business-detail-grid">
        <section className="panel">
          <div className="panel-heading">
            <h2>Account information</h2>
          </div>
          <form action={updateUser} className="business-form">
            <input name="id" type="hidden" value={account.id} />
            <div className="business-form-grid">
              <UserField label="First name" name="name" required value={account.name} />
              <UserField label="Last name" name="surname" value={account.surname} />
              <UserField label="Email" name="email" required type="email" value={account.email} />
              <UserField label="Phone" name="phone" type="tel" value={account.phone} />

              <label className="business-field">
                <span>Role</span>
                <select name="role" defaultValue={account.role ?? ""}>
                  <option value="">Contributor (no role)</option>
                  <option value="CONTRIBUTOR">Contributor</option>
                  <option value="PUBLISHER">Publisher</option>
                  <option value="ADMIN">Administrator</option>
                </select>
              </label>

              <label className="business-field">
                <span>Status</span>
                <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", marginTop: "0.25rem" }}>
                  <input
                    name="active"
                    type="checkbox"
                    defaultChecked={account.active}
                    value="on"
                  />
                  Active account
                </label>
              </label>
            </div>
            <div className="business-form-footer">
              <p className="muted">
                Record ID: {account.id}
                <br />
                Created {account.createdAt.toLocaleString()} · Updated{" "}
                {account.updatedAt.toLocaleString()}
              </p>
              <button className="button button-primary business-save" type="submit">
                Save changes
              </button>
            </div>
          </form>
        </section>

        <section className="panel">
          <div className="panel-heading">
            <h2>Publication access</h2>
          </div>
          {account.publicationAccess.length ? (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Publication</th>
                  </tr>
                </thead>
                <tbody>
                  {account.publicationAccess.map(({ publication }) => (
                    <tr key={publication.id}>
                      <td className="table-primary">
                        <Link className="text-link" href={`/publications/${publication.id}`}>
                          {publication.name}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="empty-state">This user has no publication access assigned.</div>
          )}

          {account.business && (
            <>
              <div className="panel-heading" style={{ borderTop: "1px solid var(--border)" }}>
                <h2>Linked business</h2>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Business</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="table-primary">
                        <Link className="text-link" href={`/businesses/${account.business.id}`}>
                          {account.business.name}
                        </Link>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </>
          )}

          {!isSelf && (
            <div className="panel-heading" style={{ borderTop: "1px solid var(--border)", marginTop: "auto" }}>
              <h2>Danger zone</h2>
            </div>
          )}
          {!isSelf && (
            <form action={deleteUser} style={{ padding: "1rem 1.5rem" }}>
              <input name="id" type="hidden" value={account.id} />
              <p className="muted" style={{ marginBottom: "0.75rem" }}>
                Permanently delete this user account. This action cannot be undone.
              </p>
              <button
                className="button"
                style={{ color: "var(--color-error, #c0392b)", borderColor: "var(--color-error, #c0392b)" }}
                type="submit"
              >
                Delete user
              </button>
            </form>
          )}
        </section>
      </div>
    </>
  );
}

type UserFieldProps = {
  label: string;
  name: string;
  required?: boolean;
  type?: "email" | "tel" | "text";
  value: string | null | undefined;
};

function UserField({ label, name, required = false, type = "text", value }: UserFieldProps) {
  return (
    <label className="business-field">
      <span>{label}</span>
      <input
        name={name}
        required={required}
        type={type}
        defaultValue={value ?? ""}
      />
    </label>
  );
}
