import Link from "next/link";
import { UserRole } from "@prisma/client";
import { logout } from "@/app/actions/auth";
import { TaskNotifier } from "@/components/task-notifier";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { requireUser } from "@/lib/auth";
import { countActiveTasks } from "@/lib/tasks";

const roleLabels: Record<UserRole, string> = {
  ADMIN: "Administrator",
  EDITOR: "Editor",
  CONTRIBUTOR: "Contributor",
};

export default async function WorkspaceLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await requireUser();
  const activeTaskCount = await countActiveTasks(user.id);

  return (
    <div className="app-shell">
      <WorkspaceSidebar activeTaskCount={activeTaskCount} role={user.role} />
      <TaskNotifier />

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
            {user.picturePath ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                alt=""
                className="avatar avatar-image"
                src={`/api/users/${user.id}/picture?v=${encodeURIComponent(user.picturePath)}`}
              />
            ) : (
              <div aria-hidden="true" className="avatar">
                {user.name.slice(0, 1).toUpperCase()}
              </div>
            )}
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
