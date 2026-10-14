import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { promoteSubmissionToArticle } from "@/app/actions/content";
import { RequestInfoButton } from "@/components/request-info-button";
import { ReviewButton } from "@/components/review-button";
import { SubmissionEditor } from "@/components/submission-editor";
import { SubmissionReviews } from "@/components/submission-reviews";
import { getPublicationScope, getSubmissionScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

export default async function SubmissionPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const scope = await getSubmissionScope(user);
  if (!scope) {
    redirect("/dashboard");
  }
  const [{ id }, { tab: tabParam }] = await Promise.all([params, searchParams]);
  if (!/^[\w-]{1,64}$/.test(id)) {
    notFound();
  }
  const tab = tabParam === "reviews" ? "reviews" : "edit";

  const submission = await prisma.contentSubmission.findFirst({
    where: { id, ...scope },
    include: {
      publication: { select: { id: true, name: true } },
      images: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          originalName: true,
          size: true,
        },
      },
      article: { select: { id: true } },
      business: { select: { id: true, name: true } },
    },
  });
  if (!submission) {
    notFound();
  }

  const canManage = user.role === UserRole.ADMIN || user.role === UserRole.EDITOR;

  const [editorAgent, assistantAgent] = canManage
    ? await Promise.all([
        prisma.agent.findUnique({ where: { slug: "editor" }, select: { id: true, enabled: true } }),
        prisma.agent.findUnique({ where: { slug: "assistant" }, select: { id: true, enabled: true } }),
      ])
    : [null, null];

  // Fetch reviews (all succeeded editor tasks for this submission), always needed for count + Request Info button
  const reviews = canManage && editorAgent
    ? await prisma.agentTask.findMany({
        where: {
          agentId: editorAgent.id,
          status: "SUCCEEDED",
          result: { path: ["referenceId"], equals: submission.id },
        },
        orderBy: { completedAt: "desc" },
        select: {
          id: true,
          label: true,
          result: true,
          completedAt: true,
          triggeredBy: { select: { name: true, surname: true } },
        },
      })
    : [];

  const hasReview = reviews.length > 0;

  const publicationScope = canManage ? await getPublicationScope(user) : null;
  const [publications, businesses] = await Promise.all([
    canManage && publicationScope
      ? prisma.publication.findMany({
          where: publicationScope,
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([submission.publication]),
    canManage
      ? prisma.business.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true },
        })
      : Promise.resolve([]),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/submissions">
            ← All submissions
          </Link>
          <p className="eyebrow">CONTENT SUBMISSION</p>
          <h1>Edit submission</h1>
          <p className="muted">
            Update the story details, contact information, and attached images.
          </p>
        </div>
        <div className="page-heading-actions">
          <span className="status-pill">{formatStatus(submission.status)}</span>
          {canManage && editorAgent?.enabled ? (
            <ReviewButton
              apiPath={`/api/submissions/${submission.id}/review`}
            />
          ) : null}
          {canManage && hasReview && assistantAgent?.enabled ? (
            <RequestInfoButton
              apiPath={`/api/submissions/${submission.id}/clarify`}
            />
          ) : null}
          {canManage ? (
            submission.article ? (
              <Link className="button button-secondary" href={`/articles/${submission.article.id}`}>
                Open article
              </Link>
            ) : (
              <form action={promoteSubmissionToArticle}>
                <input name="submissionId" type="hidden" value={submission.id} />
                <button className="button button-primary" type="submit">Promote to article</button>
              </form>
            )
          ) : null}
        </div>
      </div>
      <div className="sub-tabs">
        <Link
          className={`sub-tab ${tab === "edit" ? "sub-tab-active" : ""}`}
          href={`/submissions/${submission.id}`}
        >
          Edit
        </Link>
        <Link
          className={`sub-tab ${tab === "reviews" ? "sub-tab-active" : ""}`}
          href={`/submissions/${submission.id}?tab=reviews`}
        >
          Reviews{reviews.length > 0 ? ` (${reviews.length})` : ""}
        </Link>
      </div>

      {tab === "edit" ? (
        <section className="panel">
          <SubmissionEditor
            canChangePublication={canManage}
            canManageStatus={canManage}
            images={submission.images}
            initialValues={{
              id: submission.id,
              title: submission.title,
              body: submission.body,
              storyType: submission.storyType ?? "other",
              postalCode: submission.postalCode ?? "",
              publicationId: submission.publicationId,
              submitterName: submission.submitterName ?? "",
              submitterEmail: submission.submitterEmail ?? "",
              submitterPhone: submission.submitterPhone ?? "",
              status: submission.status,
              businessId: submission.businessId,
            }}
            publications={publications}
            businesses={businesses}
          />
        </section>
      ) : (
        <SubmissionReviews reviews={reviews} />
      )}
    </>
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}
