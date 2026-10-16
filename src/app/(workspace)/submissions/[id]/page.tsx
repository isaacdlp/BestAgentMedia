import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AgentTaskStatus, MessageDirection, UserRole } from "@prisma/client";
import { promoteSubmissionToArticle } from "@/app/actions/content";
import { updateSubmissionStatus } from "@/app/actions/records";
import { AgentPromptButton } from "@/components/agent-prompt-button";
import { ReviewButton } from "@/components/review-button";
import { SubmissionEditor } from "@/components/submission-editor";
import { SubmissionReviews } from "@/components/submission-reviews";
import { getPublicationScope, getSubmissionScope } from "@/lib/access";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { readReceivedInfo, submissionReviewsWhere } from "@/lib/submission-agent-requests";

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

  // Completed editorial reviews, always needed for the Reviews tab count
  const reviews = canManage && editorAgent
    ? await prisma.agentTask.findMany({
        where: submissionReviewsWhere(editorAgent.id, submission.id),
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

  // Info requests and applied revisions started from those reviews, plus replies received
  const followUpAgentIds = [editorAgent?.id, assistantAgent?.id].filter((agentId): agentId is number => agentId !== undefined);
  const [followUps, replyCount] = reviews.length
    ? await Promise.all([
        prisma.agentTask.findMany({
          where: {
            agentId: { in: followUpAgentIds },
            result: { path: ["referenceId"], equals: submission.id },
          },
          orderBy: { createdAt: "desc" },
          select: { id: true, status: true, result: true, createdAt: true, registry: { select: { id: true } } },
        }),
        prisma.emailMessage.count({
          where: {
            direction: MessageDirection.INBOUND,
            thread: {
              task: {
                AND: [
                  { result: { path: ["contentType"], equals: "clarification" } },
                  { result: { path: ["referenceId"], equals: submission.id } },
                ],
              },
            },
          },
        }),
      ])
    : [[], 0];
  const reviewActivity = followUps.flatMap((task) => {
    const result = (task.result ?? {}) as Record<string, unknown>;
    const kind =
      result.contentType === "clarification" ? ("info-request" as const)
      : result.contentType === "submission-revision" ? ("applied" as const)
      : null;
    if (!kind || typeof result.reviewTaskId !== "string") return [];
    return [{
      taskId: task.registry?.id ?? null,
      reviewTaskId: result.reviewTaskId,
      kind,
      status: kind === "info-request" ? infoRequestStatus(task.status, result.status) : revisionStatus(task.status, result.status),
      at: task.createdAt,
    }];
  });

  // What the submitter sent on each info request, shown with the review that prompted it
  const receivedInfo = followUps.flatMap((task) => {
    const result = (task.result ?? {}) as Record<string, unknown>;
    if (result.contentType !== "clarification" || typeof result.reviewTaskId !== "string") return [];
    const reviewTaskId = result.reviewTaskId;
    return readReceivedInfo(result.receivedInfo).map((item) => ({
      reviewTaskId,
      taskId: task.registry?.id ?? null,
      topic: item.topic,
      detail: item.detail,
      receivedAt: item.receivedAt,
    }));
  });

  const publicationScope = canManage ? await getPublicationScope(user) : null;
  const [publications, businesses] = await Promise.all([
    canManage && publicationScope
      ? prisma.publication.findMany({
          where: publicationScope,
          orderBy: { name: "asc" },
          select: { id: true, name: true, zipCodes: { orderBy: { code: "asc" }, select: { code: true } } },
        })
      : Promise.resolve([{ ...submission.publication, zipCodes: [] }]),
    canManage
      ? prisma.business.findMany({
          orderBy: { name: "asc" },
          select: { id: true, name: true, city: true, stateCode: true, postalCode: true, primaryCategory: true },
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
          {canManage && editorAgent?.enabled ? (
            <ReviewButton
              apiPath={`/api/submissions/${submission.id}/review`}
            />
          ) : null}
          {canManage && editorAgent?.enabled ? (
            <AgentPromptButton
              agentSlug="editor"
              apiPath={`/api/submissions/${submission.id}/apply`}
              body={{ enhance: true }}
              buttonLabel="Enhance"
              description="The Copywriter drafts an improved title and story from the submission text alone, following the same editorial guidance as reviews. No review or submitter replies are used, and facts are never invented. The submission changes only if you accept the revision."
              dialogTitle="Enhance the submission"
              placeholder="Anything the Copywriter should change, keep, or emphasize…"
              startLabel="Draft revision"
              suggestions={["Keep the original headline", "Keep it under 400 words", "Only fix grammar and clarity"]}
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
                <button className="button button-primary" disabled={submission.status !== "ACCEPTED"} title={submission.status !== "ACCEPTED" ? "Accept the submission first" : undefined} type="submit">Create Article</button>
              </form>
            )
          ) : null}
        </div>
      </div>
      {canManage ? (
        <section className="panel" style={{ marginBottom: "1.5rem" }}>
          <form action={updateSubmissionStatus} className="business-form" style={{ padding: "0.5rem 1rem" }}>
            <input name="id" type="hidden" value={submission.id} />
            <div className="review-status">
              <div aria-label="Review status" className="review-status-options" role="radiogroup">
                {[
                  ["DRAFT", "Draft"],
                  ["IN_REVIEW", "In review"],
                  ["ACCEPTED", "Accepted"],
                  ["DECLINED", "Declined"],
                ].map(([value, label]) => (
                  <label className={`review-status-option review-status-${value.toLowerCase()}`} key={value}>
                    <input defaultChecked={submission.status === value} name="status" type="radio" value={value} />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
              <button className="button button-small" type="submit">Update status</button>
            </div>
          </form>
        </section>
      ) : null}
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
            publications={publications.map((publication) => ({
              id: publication.id,
              name: publication.name,
              zipCodes: publication.zipCodes.map((zip) => zip.code),
            }))}
            businesses={businesses}
          />
        </section>
      ) : (
        <SubmissionReviews
          activity={reviewActivity}
          canApply={Boolean(editorAgent?.enabled)}
          canRequestInfo={Boolean(assistantAgent?.enabled && submission.submitterEmail)}
          receivedInfo={receivedInfo}
          replyCount={replyCount}
          reviews={reviews}
          submissionId={submission.id}
        />
      )}
    </>
  );
}

function formatStatus(status: string) {
  return status.replaceAll("_", " ").toLowerCase();
}

/** Where an info request stands: the task's end state when it ended, otherwise the conversation's. */
function infoRequestStatus(taskStatus: AgentTaskStatus, conversationStatus: unknown) {
  if (taskStatus === AgentTaskStatus.FAILED) return "failed";
  if (taskStatus === AgentTaskStatus.STOPPED) return conversationStatus === "no-response" ? "no-response" : "stopped";
  return typeof conversationStatus === "string" ? conversationStatus : "running";
}

/** Where an applied revision stands: running or failed, then waiting for approval, accepted or discarded. */
function revisionStatus(taskStatus: AgentTaskStatus, reviewStatus: unknown) {
  if (taskStatus !== AgentTaskStatus.SUCCEEDED) return taskStatus.toLowerCase();
  // Revisions drafted before approvals were required carry no review status and were applied directly
  return typeof reviewStatus === "string" ? reviewStatus : "accepted";
}
