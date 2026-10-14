import { requireUser } from "@/lib/auth";
import { updateOwnProfile } from "@/app/actions/users";

export const metadata = { title: "My Profile | BestVersionMedia" };

const roleLabels: Record<string, string> = {
  ADMIN: "Administrator",
  PUBLISHER: "Publisher",
  CONTRIBUTOR: "Contributor",
};

export default async function MyProfilePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const sp = await searchParams;
  const saved = sp.saved === "1";

  return (
    <div className="portal-page">
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACCOUNT</p>
          <h1>My Profile</h1>
          <p className="muted">Update your name and contact details.</p>
        </div>
      </div>

      {saved ? (
        <div className="portal-claimed-banner" style={{ marginBottom: "24px" }}>
          <span className="portal-claimed-banner-icon">✓</span>
          <div>
            <strong>Profile saved</strong>
            <p>Your profile has been updated successfully.</p>
          </div>
        </div>
      ) : null}

      <div className="portal-detail-grid" style={{ gridTemplateColumns: "1fr minmax(220px, 260px)" }}>
        <div className="portal-edit-form">
          <h2>Personal information</h2>
          <form action={updateOwnProfile} style={{ display: "grid", gap: "16px" }}>
            <label className="portal-field">
              First name
              <input name="name" required defaultValue={user.name} />
            </label>
            <label className="portal-field">
              Last name
              <input name="surname" defaultValue={user.surname ?? ""} />
            </label>
            <label className="portal-field">
              Phone
              <input name="phone" type="tel" defaultValue={user.phone ?? ""} />
            </label>
            <div className="portal-form-footer">
              <button className="button button-primary portal-save-btn" type="submit">
                Save changes
              </button>
            </div>
          </form>
        </div>

        <aside>
          <div className="portal-info-card">
            <h2>Account details</h2>
            <div className="portal-info-row">
              <span className="portal-info-label">Email</span>
              <span>{user.email}</span>
            </div>
            <div className="portal-info-row">
              <span className="portal-info-label">Role</span>
              <span>{user.role ? (roleLabels[user.role] ?? user.role) : "Contributor"}</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
