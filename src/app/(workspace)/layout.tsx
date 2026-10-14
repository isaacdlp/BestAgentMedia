import Link from "next/link";
import { UserRole } from "@prisma/client";
import { logout } from "@/app/actions/auth";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { requireUser } from "@/lib/auth";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrator",
  PUBLISHER: "Publisher",
  CONTRIBUTOR: "Contributor",
};

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();

  return (
    <div className="app-shell">
      <WorkspaceSidebar role={user.role} />

      <div className="main-column">
        <header className="topbar">
          <div>
            <span className="topbar-context">Best Version Media</span>
            <span className="topbar-divider">/</span>
            <span>Workspace</span>
          </div>
          <div className="user-menu">
            <Link className="user-copy" href="/my/profile">
              <strong>{[user.name, user.surname].filter(Boolean).join(" ")}</strong>
              <span>{user.role ? roleLabels[user.role] : "Contributor"}</span>
            </Link>
            <div aria-hidden="true" className="avatar">
              {user.name.slice(0, 1).toUpperCase()}
            </div>
            <form action={logout}>
              <button className="button button-quiet" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>
        <main className="workspace-content">{children}</main>
      </div>
    </div>
  );
}
