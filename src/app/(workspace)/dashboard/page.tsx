import Link from "next/link";
import { UserRole } from "@prisma/client";
import {
  getAdvertisementScope,
  getPublicationScope,
  getSubmissionScope,
} from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

const roleDescriptions: Record<UserRole, string> = {
  ADMIN: "A complete view of your publications, content, and advertising.",
  EDITOR: "Manage submissions and ads across your assigned publications.",
  CONTRIBUTOR: "Follow the progress of your content submissions.",
};

export default async function DashboardPage() {
  const user = await requireUser();
  const roleDescription = user.role
    ? roleDescriptions[user.role]
    : "Follow the progress of your content submissions.";
  const [submissionScope, advertisementScope, publicationScope] = await Promise.all([
    getSubmissionScope(user),
    getAdvertisementScope(user),
    getPublicationScope(user),
  ]);

  const [submissionCount, adCount, publicationCount, recentSubmissions, recentAds] =
    await Promise.all([
      submissionScope
        ? prisma.contentSubmission.count({ where: submissionScope })
        : Promise.resolve(0),
      advertisementScope
        ? prisma.advertisement.count({ where: advertisementScope })
        : Promise.resolve(0),
      publicationScope
        ? prisma.publication.count({ where: publicationScope })
        : Promise.resolve(0),
      submissionScope
        ? prisma.contentSubmission.findMany({
            where: submissionScope,
            orderBy: { updatedAt: "desc" },
            take: 4,
            select: {
              id: true,
              title: true,
              status: true,
              updatedAt: true,
              publication: { select: { name: true } },
            },
          })
        : Promise.resolve([]),
      advertisementScope
        ? prisma.advertisement.findMany({
            where: advertisementScope,
            orderBy: { updatedAt: "desc" },
            take: 4,
            select: {
              id: true,
              title: true,
              status: true,
              updatedAt: true,
              issues: { select: { issue: { select: { name: true, publication: { select: { name: true } } } } }, take: 1 },
            },
          })
        : Promise.resolve([]),
    ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">OVERVIEW</p>
          <h1>Good morning, {user.name}</h1>
          <p className="muted">{roleDescription}</p>
        </div>
        <span className="role-pill">
          {user.role ? user.role.toLowerCase() : "contributor"}
        </span>
      </div>

      <section aria-label="Workspace totals" className="stat-grid">
        {submissionScope !== null ? (
          <article className="stat-card">
            <span className="stat-icon icon-blue">✎</span>
            <p>Content submissions</p>
            <strong>{submissionCount}</strong>
            <span className="stat-foot">In your workspace</span>
          </article>
        ) : null}
        {advertisementScope !== null ? (
          <article className="stat-card">
            <span className="stat-icon icon-orange">▧</span>
            <p>Advertisements</p>
            <strong>{adCount}</strong>
            <span className="stat-foot">Across publications</span>
          </article>
        ) : null}
        {publicationScope !== null ? (
          <article className="stat-card">
            <span className="stat-icon icon-green">▤</span>
            <p>Publications</p>
            <strong>{publicationCount}</strong>
            <span className="stat-foot">
              {user.role === UserRole.ADMIN ? "In the platform" : "Assigned to you"}
            </span>
          </article>
        ) : null}
      </section>

      <div className="section-grid">
        {submissionScope !== null ? (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">EDITORIAL</p>
                <h2>Recent submissions</h2>
              </div>
              <Link className="text-link" href="/submissions">View all</Link>
            </div>
            {recentSubmissions.length ? (
              <div className="activity-list">
                {recentSubmissions.map((submission) => (
                  <div className="activity-row" key={submission.id}>
                    <div className="activity-symbol symbol-blue">S</div>
                    <div className="activity-main">
                      <strong>{submission.title}</strong>
                      <span>{submission.publication.name}</span>
                    </div>
                    <span className="status-pill">{formatStatus(submission.status)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Submissions will appear here when they arrive." />
            )}
          </section>
        ) : null}

        {advertisementScope !== null ? (
          <section className="panel">
            <div className="panel-heading">
              <div>
                <p className="eyebrow">ADVERTISING</p>
                <h2>Recent ads</h2>
              </div>
              <Link className="text-link" href="/ads">View all</Link>
            </div>
            {recentAds.length ? (
              <div className="activity-list">
                {recentAds.map((ad) => (
                  <div className="activity-row" key={ad.id}>
                    <div className="activity-symbol symbol-orange">A</div>
                    <div className="activity-main">
                      <strong>{ad.title}</strong>
                      <span>{ad.issues[0] ? `${ad.issues[0].issue.publication.name} · ${ad.issues[0].issue.name}` : "—"}</span>
                    </div>
                    <span className="status-pill">{formatStatus(ad.status)}</span>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState message="Ads will appear here when they are added." />
            )}
          </section>
        ) : null}
      </div>

      <section className="welcome-panel">
        <div className="welcome-mark">✦</div>
        <div>
          <p className="eyebrow">YOUR WORKSPACE</p>
          <h2>Everything for your local publication, in one place.</h2>
          <p className="muted">
            Your access is scoped to the records and publications assigned to your role.
          </p>
        </div>
      </section>
    </>
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}

function EmptyState({ message }: { message: string }) {
  return <div className="empty-state">{message}</div>;
}
