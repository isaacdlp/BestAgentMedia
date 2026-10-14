import Link from "next/link";
import { UserRole } from "@prisma/client";

export function WorkspaceSidebar({ role }: { role: UserRole | null }) {
  const isContributor = role === UserRole.CONTRIBUTOR || !role;
  const isPublisherOrAdmin = role === UserRole.ADMIN || role === UserRole.PUBLISHER;
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
        {isPublisherOrAdmin ? <Link href="/regions">Regions</Link> : null}
        {isPublisherOrAdmin ? <Link href="/publications">Publications</Link> : null}
        {isPublisherOrAdmin ? <Link href="/issues">Issues</Link> : null}
        <Link href="/articles">Articles</Link>
        <Link href="/ads">Advertisements</Link>
        <Link href="/businesses">Businesses</Link>
        <Link href="/submissions">Submissions</Link>
        {isAdmin ? <Link href="/users">Users</Link> : null}
        {isAdmin ? <Link href="/agents">Agents</Link> : null}
      </nav>
      <div className="sidebar-note">
        <span className="status-dot" />
        <span>Workspace ready</span>
      </div>
    </aside>
  );
}
