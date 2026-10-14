import Link from "next/link";
import { UserRole } from "@prisma/client";
import { TaskNavLink } from "@/components/task-nav-link";

export function WorkspaceSidebar({
  role,
  activeTaskCount,
}: {
  role: UserRole | null;
  activeTaskCount: number;
}) {
  const isContributor = role === UserRole.CONTRIBUTOR || !role;
  const isEditorOrAdmin = role === UserRole.ADMIN || role === UserRole.EDITOR;
  const isAdmin = role === UserRole.ADMIN;

  const brandHref = isContributor ? "/businesses" : "/dashboard";

  return (
    <aside className="sidebar">
      <Link className="brand" href={brandHref}>
        <span className="brand-mark">B</span>
        <span>BestAgentMedia</span>
      </Link>
      <p className="nav-label">WORKSPACE</p>
      <nav aria-label="Main navigation" className="main-nav">
        {!isContributor ? <Link href="/dashboard">Overview</Link> : null}
        {isEditorOrAdmin ? <Link href="/regions">Regions</Link> : null}
        {isEditorOrAdmin ? <Link href="/publications">Publications</Link> : null}
        {isEditorOrAdmin ? <Link href="/issues">Issues</Link> : null}
        <Link href="/articles">Articles</Link>
        <Link href="/submissions">Submissions</Link>
        <Link href="/ads">Advertisements</Link>
        <Link href="/businesses">Businesses</Link>
        {isAdmin ? <Link href="/users">Users</Link> : null}
        {isAdmin ? <Link href="/agents">Agents</Link> : null}
        <TaskNavLink initialActiveCount={activeTaskCount} />
      </nav>
      <div className="sidebar-note">
        <span className="status-dot" />
        <span>Workspace ready</span>
      </div>
    </aside>
  );
}
