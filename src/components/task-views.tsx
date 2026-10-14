"use client";

import { useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentBadge } from "@/components/agent-badge";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";
import type { LayoutDesign, LayoutElement, LayoutPage } from "@/lib/issue-design";

// ---------------------------------------------------------------------------
// Stop / delete controls shared by every task page
// ---------------------------------------------------------------------------

export function TaskControls({
  taskId,
  canStop,
  canDelete,
}: {
  taskId: number;
  canStop: boolean;
  canDelete: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function run(method: "PATCH" | "DELETE") {
    if (method === "DELETE" && !window.confirm("Delete this task and its results? This cannot be undone.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/tasks/${taskId}`, { method });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The task could not be updated.");
      if (method === "DELETE") router.push("/tasks");
      else router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The task could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  if (!canStop && !canDelete) return null;
  return (
    <div className="task-controls">
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {canStop ? (
        <button className="button button-secondary" disabled={busy} onClick={() => void run("PATCH")} type="button">
          Stop task
        </button>
      ) : null}
      {canDelete ? (
        <button className="button button-ghost-danger" disabled={busy} onClick={() => void run("DELETE")} type="button">
          Delete
        </button>
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Creative (image enhancement / ad generation)
// ---------------------------------------------------------------------------

type CreativeReviewStatus = "pending_review" | "accepted_overwrite" | "accepted_keep" | "discarded" | "iterating";

const CREATIVE_STATUS_TEXT: Record<CreativeReviewStatus, string> = {
  pending_review: "Waiting for your review — nothing has been changed yet.",
  accepted_overwrite: "Accepted — the original image was replaced.",
  accepted_keep: "Accepted — saved as a new image.",
  discarded: "Discarded — the result was removed.",
  iterating: "Iterated — a follow-up task was started from this result.",
};

export function CreativeTaskView({
  agentTaskId,
  trigger,
  reviewStatus,
  originalImageSrc,
  recordHref,
  recordLabel,
  isPublicationCover,
  iterate,
  canAct,
}: {
  agentTaskId: string;
  trigger: "enhance" | "generate-ad";
  reviewStatus: CreativeReviewStatus | null;
  originalImageSrc: string | null;
  recordHref: string | null;
  recordLabel: string;
  isPublicationCover: boolean;
  /** Request body for launching a follow-up pass; null when iteration is not possible. */
  iterate: { endpoint: string; body: Record<string, unknown>; customInstructions: string } | null;
  canAct: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [iterating, setIterating] = useState(false);
  const [instructions, setInstructions] = useState(iterate?.customInstructions ?? "");
  const isAd = trigger === "generate-ad";
  const hasResultImage = reviewStatus === "pending_review" || reviewStatus === "iterating";
  const pending = reviewStatus === "pending_review";

  async function apply(action: "remove" | "overwrite" | "keep" | "iterate") {
    const response = await fetch(`/api/creative/tasks/${agentTaskId}/apply`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) throw new Error(data.error ?? "Action failed.");
  }

  async function handleApply(action: "remove" | "overwrite" | "keep") {
    setBusy(true);
    setError("");
    try {
      await apply(action);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed.");
    } finally {
      setBusy(false);
    }
  }

  async function handleIterate() {
    if (!iterate) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(iterate.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...iterate.body, customInstructions: instructions }),
      });
      const data = (await response.json()) as { task?: LaunchedTask; error?: string };
      if (!response.ok || !data.task) throw new Error(data.error ?? "The follow-up task could not be started.");
      if (pending) await apply("iterate");
      announceTaskStarted(data.task);
      setIterating(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The follow-up task could not be started.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel task-section">
      <div className="panel-heading">
        <h2>{isAd ? "Generated advertisement" : "Enhanced image"}</h2>
        {recordHref ? <Link className="text-link" href={recordHref}>{recordLabel} →</Link> : null}
      </div>
      {reviewStatus ? <p className="muted task-review-status">{CREATIVE_STATUS_TEXT[reviewStatus]}</p> : null}

      <div className={`task-image-compare ${isAd || !originalImageSrc ? "task-image-compare-single" : ""}`}>
        {!isAd && originalImageSrc ? (
          <figure>
            <figcaption>{reviewStatus === "accepted_overwrite" ? "Current image" : "Original"}</figcaption>
            <img alt="Original" src={originalImageSrc} />
          </figure>
        ) : null}
        {hasResultImage ? (
          <figure>
            <figcaption>{isAd ? "Generated" : "Enhanced"}</figcaption>
            <img alt={isAd ? "Generated advertisement" : "Enhanced image"} className="task-image-new" src={`/api/creative/tasks/${agentTaskId}/image`} />
          </figure>
        ) : null}
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {canAct && (pending || iterate) ? (
        <div className="task-actions">
          {pending ? (
            <>
              <button className="button button-secondary button-danger" disabled={busy} onClick={() => void handleApply("remove")} type="button">
                Discard
              </button>
              {!isAd ? (
                <button className="button button-secondary" disabled={busy} onClick={() => void handleApply("overwrite")} type="button">
                  {isPublicationCover ? "Replace cover" : "Overwrite original"}
                </button>
              ) : null}
              {!isPublicationCover ? (
                <button className="button button-secondary" disabled={busy} onClick={() => void handleApply("keep")} type="button">
                  {isAd ? "Save as image" : "Keep as new image"}
                </button>
              ) : null}
            </>
          ) : null}
          {iterate && !iterating ? (
            <button className="button button-primary" disabled={busy} onClick={() => setIterating(true)} type="button">
              {isAd ? "Generate again" : "Iterate"}
            </button>
          ) : null}
        </div>
      ) : null}

      {iterating && iterate ? (
        <div className="task-iterate-form">
          <AgentBadge agentSlug="creative" />
          <label className="enhance-label">
            <span>
              Instructions for the next pass <span className="muted">(optional)</span>
            </span>
            <textarea
              className="enhance-textarea"
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={isAd ? `e.g. "bolder headline", "use the logo prominently"…` : `e.g. "brighten the sky", "crop tighter on the subject"…`}
              rows={3}
              value={instructions}
            />
          </label>
          <div className="task-actions">
            <button className="button button-secondary" disabled={busy} onClick={() => setIterating(false)} type="button">
              Cancel
            </button>
            <button className="button button-primary" disabled={busy} onClick={() => void handleIterate()} type="button">
              Start new task
            </button>
          </div>
          <p className="muted task-hint">
            {isAd
              ? "A new generation task runs in the background with the same reference images."
              : "A new enhancement task runs in the background using this result as its source."}
          </p>
        </div>
      ) : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Designer (layout generation)
// ---------------------------------------------------------------------------

const PREVIEW_WIDTH = 230;

function numberValue(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function PreviewElement({ element }: { element: LayoutElement }) {
  const style: CSSProperties = {
    left: numberValue(element.x),
    top: numberValue(element.y),
    width: numberValue(element.width, 100),
    height: numberValue(element.height, 40),
  };
  if (element.type === "image" && typeof element.src === "string") {
    return <img alt="" className="layout-preview-image" src={element.src} style={style} />;
  }
  return (
    <div
      className="layout-preview-text"
      style={{
        ...style,
        color: typeof element.fill === "string" ? element.fill : "#202a37",
        fontSize: numberValue(element.fontSize, 16),
        fontStyle: element.fontStyle === "italic" ? "italic" : "normal",
        fontWeight: element.fontWeight === "bold" ? 700 : 400,
        textAlign: element.align === "center" || element.align === "right" ? element.align : "left",
      }}
    >
      {typeof element.text === "string" ? element.text : ""}
    </div>
  );
}

function pageLabel(page: LayoutPage, index: number, count: number) {
  const meta = (page.custom?.bestAgentMedia ?? {}) as { pageType?: string };
  if (meta.pageType === "COVER" || index === 0) return "Cover";
  if (meta.pageType === "BACK_COVER" || index === count - 1) return "Back cover";
  return `Page ${index + 1}`;
}

export function LayoutTaskView({
  design,
  agentId,
  agentTaskId,
  issueId,
  issueName,
  canApply,
}: {
  design: LayoutDesign | null;
  agentId: number;
  agentTaskId: string;
  issueId: string | null;
  issueName: string | null;
  canApply: boolean;
}) {
  const router = useRouter();
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const width = numberValue(design?.width, 816);
  const height = numberValue(design?.height, 1056);
  const scale = PREVIEW_WIDTH / width;
  const pages = Array.isArray(design?.pages) ? design.pages : [];

  async function applyToIssue() {
    if (!window.confirm("Replace the issue's current layout with this generated layout?")) return;
    setApplying(true);
    setError("");
    try {
      const response = await fetch(`/api/agents/${agentId}/tasks/${agentTaskId}/redeploy`, { method: "POST" });
      const result = (await response.json()) as { issueId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "The layout could not be applied.");
      router.push(`/issues/${result.issueId ?? issueId ?? ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The layout could not be applied.");
      setApplying(false);
    }
  }

  return (
    <section className="panel task-section">
      <div className="panel-heading">
        <h2>Generated layout</h2>
        <div className="task-actions task-actions-inline">
          {issueId ? <Link className="text-link" href={`/issues/${issueId}`}>Open {issueName ?? "issue"} →</Link> : null}
          {canApply && design && issueId ? (
            <button className="button button-primary" disabled={applying} onClick={() => void applyToIssue()} type="button">
              {applying ? "Applying…" : "Apply to issue"}
            </button>
          ) : null}
        </div>
      </div>
      <p className="muted task-review-status">
        This is a proposal. The issue is unchanged until you apply it; the layout then opens in the
        editor, where every text and image stays editable.
      </p>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {pages.length ? (
        <div className="layout-preview-grid">
          {pages.map((page, index) => (
            <figure className="layout-preview-page" key={page.id ?? index}>
              <div className="layout-preview-frame" style={{ width: width * scale, height: height * scale }}>
                <div
                  className="layout-preview-canvas"
                  style={{
                    width,
                    height,
                    background: typeof page.background === "string" ? page.background : "#fff",
                    transform: `scale(${scale})`,
                  }}
                >
                  {(page.children ?? []).map((element, elementIndex) => (
                    <PreviewElement element={element} key={element.id ?? elementIndex} />
                  ))}
                </div>
              </div>
              <figcaption>{pageLabel(page, index, pages.length)}</figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="empty-state">This task has no stored layout.</div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Email drafts (Assistant / Marketer)
// ---------------------------------------------------------------------------

export function EmailDraftView({
  agentId,
  agentTaskId,
  draft,
  subAgents,
  canSend,
  recordHref,
  recordLabel,
  threadHref,
}: {
  agentId: number;
  agentTaskId: string;
  draft: { kind: string | null; to: string; subject: string; body: string; sent: boolean; sentTo: string | null };
  subAgents: { id: number; name: string }[];
  canSend: boolean;
  recordHref: string | null;
  recordLabel: string;
  threadHref: string | null;
}) {
  const router = useRouter();
  const [subAgentId, setSubAgentId] = useState(subAgents[0]?.id ?? 0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  async function send() {
    if (!subAgentId) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/agents/${agentId}/tasks/${agentTaskId}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAgentId }),
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "The email could not be sent.");
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The email could not be sent.");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="panel task-section">
      <div className="panel-heading">
        <h2>{draft.kind ?? "Email draft"}</h2>
        {recordHref ? <Link className="text-link" href={recordHref}>{recordLabel} →</Link> : null}
      </div>
      <p className="muted task-review-status">
        {draft.sent
          ? `Sent${draft.sentTo ? ` to ${draft.sentTo}` : ""}.`
          : "Draft — nothing has been sent. Review it before sending."}
      </p>
      <dl className="task-email-meta">
        <dt>To</dt>
        <dd>{draft.to}</dd>
        <dt>Subject</dt>
        <dd>{draft.subject}</dd>
      </dl>
      <pre className="task-email-body">{draft.body}</pre>
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {draft.sent ? (
        threadHref ? <Link className="text-link" href={threadHref}>View conversation →</Link> : null
      ) : canSend ? (
        subAgents.length ? (
          <div className="task-actions">
            <label className="task-send-from">
              <span className="muted">Send as</span>
              <select onChange={(event) => setSubAgentId(Number(event.target.value))} value={subAgentId}>
                {subAgents.map((subAgent) => (
                  <option key={subAgent.id} value={subAgent.id}>{subAgent.name}</option>
                ))}
              </select>
            </label>
            <button className="button button-primary" disabled={sending || !subAgentId} onClick={() => void send()} type="button">
              {sending ? "Sending…" : "Send email"}
            </button>
          </div>
        ) : (
          <p className="muted">Add a sub agent with email settings to this agent before sending.</p>
        )
      ) : (
        <p className="muted">An administrator can send this draft.</p>
      )}
    </section>
  );
}
