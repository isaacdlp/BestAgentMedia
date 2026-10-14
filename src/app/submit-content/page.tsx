import type { Metadata } from "next";
import Link from "next/link";
import { PublicSubmissionForm } from "@/components/public-submission-form";
import { TaskNotifier } from "@/components/task-notifier";
import { WorkspaceSidebar } from "@/components/workspace-sidebar";
import { getCurrentUser } from "@/lib/auth";
import { countActiveTasks } from "@/lib/tasks";

export const metadata: Metadata = {
  title: "Submit a Story | BestAgentMedia",
  description: "Share a community story with your local publication.",
};

export default async function SubmitContentPage({
  searchParams,
}: {
  searchParams: Promise<{ postal_code?: string; publication?: string }>;
}) {
  const params = await searchParams;
  const initialPostalCode =
    params.postal_code && /^\d{5}$/.test(params.postal_code)
      ? params.postal_code
      : "";
  const initialPublicationId =
    params.publication && /^[1-9]\d*$/.test(params.publication)
      ? Number(params.publication)
      : null;
  const user = await getCurrentUser();

  const submissionContent = (
    <>
      <header className="public-submission-header">
        <Link className="public-submission-brand" href="/">
          <span className="brand-mark">B</span>
          <span>BestAgentMedia</span>
        </Link>
        <span>Community story submission</span>
      </header>
      <div className="public-submission-content">
        <div className="public-submission-heading">
          <p className="eyebrow">YOUR COMMUNITY, IN PRINT</p>
          <h1>Share a story</h1>
          <p className="muted">
            Tell us about a neighbor, group, event, or moment that makes your
            community special.
          </p>
        </div>
        <PublicSubmissionForm
          initialContact={{
            firstName: user?.name ?? "",
            lastName: user?.surname ?? "",
            email: user?.email ?? "",
            phone: user?.phone ?? "",
          }}
          initialPostalCode={initialPostalCode}
          initialPublicationId={
            initialPublicationId !== null && Number.isSafeInteger(initialPublicationId)
              ? initialPublicationId
              : null
          }
        />
      </div>
      <footer className="public-submission-footer">
        A member of the local publication team may contact you about your story.
      </footer>
    </>
  );

  if (user) {
    return (
      <div className="app-shell">
        <WorkspaceSidebar activeTaskCount={await countActiveTasks(user.id)} role={user.role} />
        <TaskNotifier />
        <div className="main-column">
          <main className="public-submission-page">{submissionContent}</main>
        </div>
      </div>
    );
  }

  return (
    <main className="public-submission-page">
      {submissionContent}
    </main>
  );
}
