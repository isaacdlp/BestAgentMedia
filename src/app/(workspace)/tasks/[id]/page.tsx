import Link from "next/link";
import { notFound } from "next/navigation";
import { UserRole } from "@prisma/client";
import { AgentBadge } from "@/components/agent-badge";
import { TaskResultSummary, TaskStepLog, type TaskResult, type TaskStep } from "@/components/agent-task-list";
import { PromotionDealDetails } from "@/components/promotion-deal-panel";
import { PromotionSaleDetails } from "@/components/promotion-sale-panel";
import { TaskAutoRefresh } from "@/components/task-auto-refresh";
import { CreativeTaskView, EmailDraftView, LayoutTaskView, TaskControls, type CreativeFollowUp } from "@/components/task-views";
import { requireUser } from "@/lib/auth";
import type { CreativeTaskResult } from "@/lib/creative-agent";
import { prisma } from "@/lib/db";
import type { LayoutDesign } from "@/lib/issue-design";
import { getPromotionDealByTask } from "@/lib/promotion-deals";
import { getPromotionSaleByTask } from "@/lib/promotion-sales";
import { formatTaskDuration, isTaskActive, TASK_STATUS_LABELS } from "@/lib/task-status";
import { getTaskScope, getTaskTemplate } from "@/lib/tasks";

const TEMPLATE_EYEBROWS = {
  "business-import": "BUSINESS IMPORT",
  reachout: "BUSINESS ONBOARDING",
  layout: "LAYOUT DESIGN",
  creative: "CREATIVE",
  "email-draft": "EMAIL DRAFT",
  review: "EDITORIAL REVIEW",
  promotion: "ADVERTISER REVIEW & PROMOTION",
  sale: "PAID PROMOTION SALE",
  generic: "AGENT TASK",
} as const;

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) notFound();

  const task = await prisma.task.findFirst({
    where: { id: Number(id), ...getTaskScope(user) },
    include: {
      agent: { select: { id: true, name: true, slug: true } },
      createdBy: { select: { name: true, surname: true } },
      agentTask: {
        select: {
          id: true,
          steps: true,
          result: true,
          error: true,
          subAgentId: true,
          issue: { select: { id: true, name: true } },
        },
      },
      businessImportTask: {
        include: {
          businesses: { orderBy: [{ city: "asc" }, { name: "asc" }], select: { id: true, name: true } },
        },
      },
      reachoutTask: {
        include: {
          business: { select: { id: true, name: true, email: true } },
          subAgent: { select: { id: true, name: true, agentId: true } },
          thread: { select: { _count: { select: { messages: true } } } },
        },
      },
    },
  });
  if (!task) notFound();

  const isAdmin = user.role === UserRole.ADMIN;
  const canManageContent = isAdmin || user.role === UserRole.EDITOR;
  const active = isTaskActive(task.status);
  const result = task.agentTask?.result ?? null;
  const template = getTaskTemplate(task.source, task.agent?.slug ?? null, result);
  const steps = Array.isArray(task.agentTask?.steps) ? (task.agentTask.steps as TaskStep[]) : [];
  const launchedBy = task.createdBy
    ? [task.createdBy.name, task.createdBy.surname].filter(Boolean).join(" ")
    : "Automatic";
  const promotionDeal =
    template === "promotion" && task.agentTask ? await getPromotionDealByTask(task.agentTask.id) : null;
  const promotionSale = template === "sale" && task.agentTask ? await getPromotionSaleByTask(task.agentTask.id) : null;

  return (
    <>
      <TaskAutoRefresh active={active} />
      <div className="page-heading">
        <div>
          <Link className="text-link back-link" href="/tasks">← All tasks</Link>
          {task.agent ? (
            <div style={{ margin: "14px 0 18px" }}>
              <AgentBadge
                agentSlug={task.agent.slug}
                subAgentId={task.agentTask?.subAgentId ?? task.reachoutTask?.subAgent?.id}
              />
            </div>
          ) : null}
          <p className="eyebrow">{TEMPLATE_EYEBROWS[template]}</p>
          <h1>{task.name}</h1>
          <p className="muted">
            {task.agent ? `${task.agent.name} agent` : "No agent"} · started {task.createdAt.toLocaleString()}
            {task.finishedAt ? ` · finished ${task.finishedAt.toLocaleString()}` : ""}
            {" · "}{formatTaskDuration(task.createdAt, task.finishedAt)}
            {" · by "}{launchedBy}
          </p>
        </div>
        <div className="page-heading-actions">
          <span className={`agent-task-status-chip task-status-large agent-task-status-${task.status.toLowerCase()}`}>
            {TASK_STATUS_LABELS[task.status]}
          </span>
          <TaskControls canDelete={isAdmin} canStop={active} taskId={task.id} />
        </div>
      </div>

      {active && task.source === "AGENT" ? (
        <div className="task-progress-banner" role="status">
          <span aria-hidden="true" className="enhance-spinner task-progress-spinner" />
          <span>
            {template === "promotion"
              ? "The Marketer is handling this conversation and answers the advertiser's replies automatically. You will be notified when they sign up or decline."
              : template === "sale"
                ? "The Marketer is selling to this business and answers its replies automatically. When the business buys, the purchased ads and articles are created as drafts and you are notified."
                : "This task is running in the background. You can leave this page — you will be notified when it finishes."}
          </span>
        </div>
      ) : null}

      {task.agentTask?.error ? <p className="form-error task-error">{task.agentTask.error}</p> : null}

      {template === "business-import" && task.businessImportTask ? (
        <section className="panel task-section business-import-task-detail">
          <h2>Import results</h2>
          <p className="business-import-task-message">{task.businessImportTask.message}</p>
          <p className="muted business-import-task-meta">
            Source: {task.businessImportTask.sourceProvider === "HERE" ? "HERE Maps" : task.businessImportTask.sourceProvider}
            {" · "}ZIP {task.businessImportTask.zipCode}
            {" · "}Categories: {task.businessImportTask.categories.join(", ")}
            {" · "}Maximum new businesses: {task.businessImportTask.newBusinessLimit}
          </p>
          <div className="business-import-task-businesses">
            <strong>Imported businesses ({task.businessImportTask.businesses.length})</strong>
            {task.businessImportTask.businesses.length ? (
              <div className="business-import-task-business-grid">
                {task.businessImportTask.businesses.map((business) => (
                  <Link className="business-import-task-business-card" href={`/businesses/${business.id}`} key={business.id}>
                    <span>{business.name}</span>
                  </Link>
                ))}
              </div>
            ) : (
              <p className="muted">{active ? "No businesses imported yet." : "No businesses were created by this task."}</p>
            )}
          </div>
        </section>
      ) : null}

      {template === "reachout" && task.reachoutTask ? (
        <section className="panel task-section">
          <div className="panel-heading">
            <h2>Onboarding sequence</h2>
            <Link className="text-link" href={`/businesses/${task.reachoutTask.business.id}`}>
              Open {task.reachoutTask.business.name} →
            </Link>
          </div>
          <p className="business-import-task-message">{task.reachoutTask.message || "Waiting to start."}</p>
          <dl className="task-email-meta">
            <dt>Recipient</dt>
            <dd>{task.reachoutTask.business.email ?? "No email on record"}</dd>
            <dt>Sent by</dt>
            <dd>{task.reachoutTask.subAgent?.name ?? "Not assigned yet"}</dd>
            <dt>Initial email</dt>
            <dd>{task.reachoutTask.initialEmailSentAt?.toLocaleString() ?? "Not sent"}</dd>
            <dt>Reminder 1</dt>
            <dd>{task.reachoutTask.reminder1SentAt?.toLocaleString() ?? "Not sent"}</dd>
            <dt>Reminder 2</dt>
            <dd>{task.reachoutTask.reminder2SentAt?.toLocaleString() ?? "Not sent"}</dd>
          </dl>
          {task.reachoutTask.subAgent && task.reachoutTask.threadId && isAdmin ? (
            <Link
              className="text-link"
              href={`/agents/${task.reachoutTask.subAgent.agentId}/sub-agents/${task.reachoutTask.subAgent.id}`}
            >
              View conversation ({task.reachoutTask.thread?._count.messages ?? 0} messages) →
            </Link>
          ) : null}
        </section>
      ) : null}

      {template === "layout" && task.agentTask && task.agent ? (
        task.status === "SUCCEEDED" ? (
          <LayoutTaskView
            agentId={task.agent.id}
            agentTaskId={task.agentTask.id}
            canApply={canManageContent}
            design={((result as { design?: LayoutDesign } | null)?.design) ?? null}
            issueId={task.agentTask.issue?.id ?? null}
            issueName={task.agentTask.issue?.name ?? null}
          />
        ) : null
      ) : null}

      {template === "creative" && task.agentTask && task.status === "SUCCEEDED" && result ? (
        <CreativeSection agentTaskId={task.agentTask.id} canAct={canManageContent} result={result as CreativeTaskResult} />
      ) : null}

      {template === "email-draft" && task.agentTask && task.agent && result ? (
        <EmailSection
          agentId={task.agent.id}
          agentTaskId={task.agentTask.id}
          canSend={isAdmin}
          result={result as Record<string, unknown>}
          subAgentId={task.agentTask.subAgentId}
        />
      ) : null}

      {template === "review" && task.agent && result ? (
        <section className="panel task-section">
          <div className="panel-heading">
            <h2>Editorial feedback</h2>
            <ReviewRecordLink result={result as TaskResult} />
          </div>
          <p className="muted task-review-status">
            Suggestions only — the {(result as TaskResult).contentType === "article" ? "article" : "submission"} has not been changed.
          </p>
          <TaskResultSummary agentId={task.agent.id} result={result as TaskResult} />
        </section>
      ) : null}

      {template === "promotion" && promotionDeal ? (
        <section className="panel task-section">
          <div className="panel-heading">
            <h2>Review &amp; promotion</h2>
            {promotionDeal.advertisementId ? (
              <Link className="text-link" href={`/ads/${promotionDeal.advertisementId}`}>Open advertisement →</Link>
            ) : promotionDeal.articleId ? (
              <Link className="text-link" href={`/articles/${promotionDeal.articleId}`}>Open article →</Link>
            ) : null}
          </div>
          <PromotionDealDetails deal={promotionDeal} showConversationLink={isAdmin} showTaskLink={false} />
        </section>
      ) : null}

      {template === "sale" && promotionSale ? (
        <section className="panel task-section">
          <div className="panel-heading">
            <h2>Promotion sale</h2>
          </div>
          <PromotionSaleDetails sale={promotionSale} showConversationLink={isAdmin} />
        </section>
      ) : null}

      {task.source === "AGENT" ? (
        <section className="panel task-section">
          <h2>Activity log</h2>
          <TaskStepLog steps={steps} />
        </section>
      ) : null}
    </>
  );
}

function ReviewRecordLink({ result }: { result: TaskResult }) {
  if (!result.referenceId) return null;
  const isArticle = result.contentType === "article";
  return (
    <Link className="text-link" href={`/${isArticle ? "articles" : "submissions"}/${result.referenceId}`}>
      Open {isArticle ? "article" : "submission"} →
    </Link>
  );
}

function creativeOriginal(result: CreativeTaskResult): { src: string | null; href: string | null; label: string } {
  const { imageType, parentId, imageId } = result;
  if (result.trigger === "generate-ad") return { src: null, href: `/ads/${parentId}`, label: "Open advertisement" };
  switch (imageType) {
    case "submission":
      return { src: `/api/submissions/${parentId}/images/${imageId}`, href: `/submissions/${parentId}/images/${imageId}`, label: "Open image" };
    case "article":
      return { src: `/api/articles/${parentId}/images/${imageId}`, href: `/articles/${parentId}/images/${imageId}`, label: "Open image" };
    case "business":
      return { src: `/api/businesses/${parentId}/images/${imageId}`, href: `/businesses/${parentId}/images/${imageId}`, label: "Open image" };
    case "ad":
      return { src: `/api/ads/${parentId}/images/${imageId}`, href: `/ads/${parentId}/images/${imageId}`, label: "Open image" };
    case "publication":
      return {
        src: /^[\w.-]+$/.test(result.originalFileName) ? `/media/publications/${encodeURIComponent(result.originalFileName)}` : null,
        href: `/publications/${parentId}/cover`,
        label: "Open cover",
      };
  }
}

function CreativeSection({
  agentTaskId,
  result,
  canAct,
}: {
  agentTaskId: string;
  result: CreativeTaskResult;
  canAct: boolean;
}) {
  const original = creativeOriginal(result);
  const followUps: CreativeFollowUp[] = [];
  if (result.trigger === "generate-ad") {
    const referenceImageIds = result.referenceImageIds ?? [];
    // A result that was already saved or discarded has no generated ad left to revise.
    if (result.status === "pending_review" || result.status === "iterating") {
      followUps.push({
        label: "Iterate",
        endpoint: "/api/creative/generate-ad",
        body: { adId: result.parentId, imageIds: referenceImageIds, iterateFromTaskId: agentTaskId },
        customInstructions: "",
        placeholder: `e.g. "bolder headline", "make the phone number larger", "warmer colours"…`,
        hint: "A new task revises this generated ad in the background, keeping its size unless you name another.",
      });
    }
    if (referenceImageIds.length) {
      followUps.push({
        label: "Generate again",
        endpoint: "/api/creative/generate-ad",
        body: { adId: result.parentId, imageIds: referenceImageIds },
        customInstructions: result.customInstructions,
        placeholder: `e.g. "bolder headline", "use the logo prominently"…`,
        hint: "A new generation task starts over in the background with the same reference images.",
      });
    }
  } else if (result.status === "pending_review") {
    // A result that was already accepted or discarded has no image left to iterate from.
    followUps.push({
      label: "Iterate",
      endpoint: "/api/creative/enhance",
      body: {
        imageType: result.imageType,
        imageId: result.imageId,
        parentId: result.parentId,
        iterateFromTaskId: agentTaskId,
      },
      customInstructions: "",
      placeholder: `e.g. "brighten the sky", "crop tighter on the subject"…`,
      hint: "A new enhancement task runs in the background using this result as its source.",
    });
  }

  return (
    <CreativeTaskView
      agentTaskId={agentTaskId}
      canAct={canAct}
      isPublicationCover={result.imageType === "publication"}
      followUps={followUps}
      originalImageSrc={original.src}
      recordHref={original.href}
      recordLabel={original.label}
      reviewStatus={result.status ?? null}
      trigger={result.trigger}
    />
  );
}

function EmailSection({
  agentId,
  agentTaskId,
  result,
  subAgentId,
  canSend,
}: {
  agentId: number;
  agentTaskId: string;
  result: Record<string, unknown>;
  subAgentId: number | null;
  canSend: boolean;
}) {
  const text = (value: unknown) => (typeof value === "string" ? value : "");
  const kind =
    result.pitchType === "sponsored_article"
      ? "Sponsored article pitch"
      : result.pitchType === "advertisement"
        ? "Advertisement pitch"
        : result.contentType === "clarification"
          ? "Information request"
          : result.trigger === "business"
            ? "Business invitation"
            : result.trigger === "submission"
              ? "Contributor invitation"
              : null;
  const referenceId = result.referenceId;
  const isBusiness = result.trigger === "business" || result.trigger === "marketer";
  const recordHref =
    referenceId === undefined || referenceId === null
      ? null
      : `/${isBusiness ? "businesses" : "submissions"}/${String(referenceId)}`;

  return (
    <EmailDraftViewLoader
      agentId={agentId}
      agentTaskId={agentTaskId}
      canSend={canSend}
      draft={{
        kind,
        to: text(result.emailTo),
        subject: text(result.emailSubject),
        body: text(result.bodyPreview),
        sent: result.status === "sent",
        sentTo: text(result.sentTo) || null,
      }}
      recordHref={recordHref}
      recordLabel={isBusiness ? "Open business" : "Open submission"}
      threadHref={subAgentId && canSend ? `/agents/${agentId}/sub-agents/${subAgentId}` : null}
    />
  );
}

async function EmailDraftViewLoader(props: Omit<Parameters<typeof EmailDraftView>[0], "subAgents">) {
  const subAgents =
    props.canSend && !props.draft.sent
      ? await prisma.subAgent.findMany({
          where: { agentId: props.agentId },
          orderBy: { createdAt: "asc" },
          select: { id: true, name: true },
        })
      : [];
  return <EmailDraftView {...props} subAgents={subAgents} />;
}
