"use client";

import { useMemo, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AgentBadge } from "@/components/agent-badge";
import { announceTaskStarted, type LaunchedTask } from "@/lib/task-events";
import type { LayoutDesign, LayoutElement, LayoutPage } from "@/lib/issue-design";
import type { ComposedIssue, ComposedPage, ComposedSlot } from "@/lib/issue-composition";
import { findIssuePageTemplate, TEMPLATE_REFERENCE_HEIGHT, TEMPLATE_REFERENCE_WIDTH, type TemplateSlot } from "@/lib/issue-templates";
import { diffWords, type DiffSegment } from "@/lib/text-diff";

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
          Stop
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

/** A follow-up Creative task launched from a result (Iterate, Generate again). */
export type CreativeFollowUp = {
  label: string;
  endpoint: string;
  body: Record<string, unknown>;
  /** Prefilled instructions for the next pass. */
  customInstructions: string;
  placeholder: string;
  hint: string;
};

export function CreativeTaskView({
  agentTaskId,
  trigger,
  reviewStatus,
  originalImageSrc,
  recordHref,
  recordLabel,
  isPublicationCover,
  followUps,
  canAct,
}: {
  agentTaskId: string;
  trigger: "enhance" | "generate-ad";
  reviewStatus: CreativeReviewStatus | null;
  originalImageSrc: string | null;
  recordHref: string | null;
  recordLabel: string;
  isPublicationCover: boolean;
  /** Follow-up passes that can be launched from this result; the first is the primary action. */
  followUps: CreativeFollowUp[];
  canAct: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [iterate, setIterate] = useState<CreativeFollowUp | null>(null);
  const [instructions, setInstructions] = useState("");
  const iterating = iterate !== null;
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
      setIterate(null);
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

      {canAct && (pending || followUps.length) ? (
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
                <button className={`button ${isAd ? "button-primary" : "button-secondary"}`} disabled={busy} onClick={() => void handleApply("keep")} type="button">
                  {isAd ? "Save as image" : "Keep as new image"}
                </button>
              ) : null}
            </>
          ) : null}
          {!iterating
            ? followUps.map((followUp, index) => (
                <button
                  className={`button ${index === 0 && !(isAd && pending) ? "button-primary" : "button-secondary"}`}
                  disabled={busy}
                  key={followUp.label}
                  onClick={() => {
                    setInstructions(followUp.customInstructions);
                    setIterate(followUp);
                  }}
                  type="button"
                >
                  {followUp.label}
                </button>
              ))
            : null}
        </div>
      ) : null}

      {iterate ? (
        <div className="task-iterate-form">
          <AgentBadge agentSlug="creative" />
          <label className="enhance-label">
            <span>
              {iterate.label}: instructions for the next pass <span className="muted">(optional)</span>
            </span>
            <textarea
              className="enhance-textarea"
              onChange={(event) => setInstructions(event.target.value)}
              placeholder={iterate.placeholder}
              rows={3}
              value={instructions}
            />
          </label>
          <div className="task-actions">
            <button className="button button-secondary" disabled={busy} onClick={() => setIterate(null)} type="button">
              Cancel
            </button>
            <button className="button button-primary" disabled={busy} onClick={() => void handleIterate()} type="button">
              Start new task
            </button>
          </div>
          <p className="muted task-hint">{iterate.hint}</p>
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

// Composed layouts (Designer composition): each page is drawn from its template's slot frames
// with the composed text, photos and ad artwork.
export type CompositionSummary = {
  summary?: string;
  model?: string;
  outcome?: "designer" | "repaired" | "fallback";
  repairs?: string[];
  warnings?: string[];
  instructions?: string;
  articleCount?: number;
  adCount?: number;
};

const SERIF_STACK = "Merriweather, 'Source Serif Pro', Georgia, serif";

function ComposedSlotPreview({ slot, content }: { slot: TemplateSlot; content: ComposedSlot | undefined }) {
  const { x, y, width, height } = slot.frame;
  const box: CSSProperties = { left: x, top: y, width, height };
  if (slot.kind === "rect") return <div className="layout-preview-shape" style={{ ...box, background: slot.color }} />;
  if (!content || content.kind === "omit") return null;
  if (content.kind === "image") {
    const isAd = slot.role === "ad" || content.fit === "Contain";
    if (!content.src) {
      return <div className={`layout-preview-placeholder${isAd ? " is-ad" : ""}`} style={box}>{isAd ? "AD" : "PHOTO"}</div>;
    }
    return (
      <img
        alt={content.link?.title ?? ""}
        className="layout-preview-image"
        src={content.src}
        style={{ ...box, objectFit: content.fit === "Contain" ? "contain" : "cover" }}
      />
    );
  }
  if (slot.kind !== "text") return null;
  return (
    <div
      className="layout-preview-text"
      style={{
        ...box,
        color: slot.color,
        fontFamily: SERIF_STACK,
        fontSize: slot.fontSize,
        fontWeight: slot.bold ? 700 : 400,
        lineHeight: slot.lineHeight ?? 1.25,
        textAlign: slot.align === "Justify" ? "justify" : (slot.align.toLowerCase() as "left" | "center" | "right"),
        display: slot.verticalAlign && slot.verticalAlign !== "Top" ? "flex" : undefined,
        flexDirection: "column",
        justifyContent: slot.verticalAlign === "Center" ? "center" : slot.verticalAlign === "Bottom" ? "flex-end" : undefined,
      }}
    >
      {content.text}
    </div>
  );
}

function ComposedPagePreview({ page, scale }: { page: ComposedPage; scale: number }) {
  const template = findIssuePageTemplate(page.templateId);
  const content = new Map(page.slots.map((slot) => [slot.slotId, slot]));
  return (
    <div
      className="layout-preview-canvas"
      style={{
        width: TEMPLATE_REFERENCE_WIDTH,
        height: TEMPLATE_REFERENCE_HEIGHT,
        background: template?.background ?? "#fff",
        transform: `scale(${scale})`,
      }}
    >
      {template?.slots.map((slot) => <ComposedSlotPreview content={content.get(slot.id)} key={slot.id} slot={slot} />)}
    </div>
  );
}

const COMPOSED_PREVIEW_WIDTH = 260;

function ComposedPages({ composition }: { composition: ComposedIssue }) {
  const scale = COMPOSED_PREVIEW_WIDTH / TEMPLATE_REFERENCE_WIDTH;
  const count = composition.pages.length;
  return (
    <div className="layout-preview-grid">
      {composition.pages.map((page, index) => (
        <figure className="layout-preview-page layout-preview-composed" key={index}>
          <div className="layout-preview-frame" style={{ width: COMPOSED_PREVIEW_WIDTH, height: TEMPLATE_REFERENCE_HEIGHT * scale }}>
            <ComposedPagePreview page={page} scale={scale} />
          </div>
          <figcaption>
            {index === 0 ? "Cover" : index === count - 1 ? "Back cover" : `Page ${index + 1}`}
            <span className="layout-preview-template"> · {findIssuePageTemplate(page.templateId)?.name ?? page.templateId}</span>
            {page.note ? <span className="layout-preview-note">{page.note}</span> : null}
          </figcaption>
        </figure>
      ))}
    </div>
  );
}

const OUTCOME_LABELS = {
  designer: "Planned by the Designer",
  repaired: "Planned by the Designer, completed automatically",
  fallback: "Laid out automatically",
} as const;

export function LayoutTaskView({
  design,
  composition = null,
  details = {},
  agentId,
  agentTaskId,
  issueId,
  issueName,
  canApply,
}: {
  design: LayoutDesign | null;
  composition?: ComposedIssue | null;
  details?: CompositionSummary;
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
          {canApply && (design || composition) && issueId ? (
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
      {composition ? (
        <>
          <div className="layout-composition-summary">
            <p className="layout-composition-meta">
              <span className="status-pill">{OUTCOME_LABELS[details.outcome ?? "designer"]}</span>
              <span className="muted">
                {composition.pages.length} pages · {details.articleCount ?? 0} article(s) · {details.adCount ?? 0} ad(s)
                {details.model ? ` · ${details.model}` : ""}
              </span>
            </p>
            {details.summary ? <p>{details.summary}</p> : null}
            {details.instructions ? (
              <p className="muted"><strong>Custom instructions:</strong> {details.instructions}</p>
            ) : null}
            {details.repairs?.length ? (
              <details className="layout-composition-notes" open>
                <summary>Automatic corrections ({details.repairs.length})</summary>
                <ul>{details.repairs.map((item) => <li key={item}>{item}</li>)}</ul>
              </details>
            ) : null}
            {details.warnings?.length ? (
              <details className="layout-composition-notes">
                <summary>Check before printing ({details.warnings.length})</summary>
                <ul>{details.warnings.map((item) => <li key={item}>{item}</li>)}</ul>
              </details>
            ) : null}
          </div>
          <ComposedPages composition={composition} />
        </>
      ) : pages.length ? (
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
  draft,
  recordHref,
  recordLabel,
  threadHref,
}: {
  draft: { kind: string | null; to: string; subject: string; body: string; sent: boolean; sentTo: string | null };
  recordHref: string | null;
  recordLabel: string;
  threadHref: string | null;
}) {
  return (
    <section className="panel task-section">
      <div className="panel-heading">
        <h2>{draft.kind ?? "Email draft"}</h2>
        {recordHref ? <Link className="text-link" href={recordHref}>{recordLabel} →</Link> : null}
      </div>
      <p className="muted task-review-status">
        {draft.sent
          ? `Sent${draft.sentTo ? ` to ${draft.sentTo}` : ""}.`
          : "Draft — not sent."}
      </p>
      <dl className="task-email-meta">
        <dt>To</dt>
        <dd>{draft.to}</dd>
        <dt>Subject</dt>
        <dd>{draft.subject}</dd>
      </dl>
      <pre className="task-email-body">{draft.body}</pre>
      {draft.sent && threadHref ? <Link className="text-link" href={threadHref}>View conversation →</Link> : null}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Copywriter revision of a submission or article (side-by-side approval)
// ---------------------------------------------------------------------------

export type RevisionReviewStatus = "pending_review" | "accepted" | "discarded";
export type RevisionTarget = "submission" | "article";

function revisionStatusText(status: RevisionReviewStatus, target: RevisionTarget) {
  switch (status) {
    case "pending_review":
      return `Waiting for your approval — the ${target} has not been changed yet.`;
    case "accepted":
      return `Accepted — the ${target}'s title and body were replaced with the revision.`;
    default:
      return `Discarded — the ${target} was left unchanged.`;
  }
}

/** Where a revision is opened and resolved for each kind of record. */
const REVISION_PATHS: Record<RevisionTarget, { page: string; api: (id: string, taskId: string) => string }> = {
  submission: { page: "/submissions", api: (id, taskId) => `/api/submissions/${id}/apply/${taskId}` },
  article: { page: "/articles", api: (id, taskId) => `/api/articles/${id}/enhance/${taskId}` },
};

function DiffText({ segments, fallback, kind }: { segments: DiffSegment[] | null; fallback: string; kind: "removed" | "added" }) {
  if (!segments) return <>{fallback}</>;
  return (
    <>
      {segments.map((segment, index) =>
        segment.changed ? (
          kind === "removed" ? <del key={index}>{segment.text}</del> : <ins key={index}>{segment.text}</ins>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </>
  );
}

export function RevisionView({
  target,
  recordId,
  agentTaskId,
  status,
  previous,
  proposed,
  editedSince,
  canAct,
}: {
  target: RevisionTarget;
  /** ID of the submission or article the revision is for. */
  recordId: string;
  agentTaskId: string;
  status: RevisionReviewStatus;
  /** The record as it was when the revision was drafted. */
  previous: { title: string; body: string };
  proposed: { title: string; body: string };
  /** The record changed after the revision was drafted (only meaningful while pending). */
  editedSince: boolean;
  canAct: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const titleDiff = useMemo(() => diffWords(previous.title, proposed.title), [previous.title, proposed.title]);
  const bodyDiff = useMemo(() => diffWords(previous.body, proposed.body), [previous.body, proposed.body]);
  const pending = status === "pending_review";

  async function resolve(action: "accept" | "discard") {
    if (action === "accept" && editedSince && !window.confirm(
      `The ${target} was edited after this revision was drafted. Accepting replaces those edits with the revision. Continue?`,
    )) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch(REVISION_PATHS[target].api(recordId, agentTaskId), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, force: action === "accept" && editedSince }),
      });
      const data = (await response.json()) as { error?: string; code?: string };
      if (!response.ok) {
        if (data.code === "edited-since") router.refresh();
        throw new Error(data.error ?? "The revision could not be updated.");
      }
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The revision could not be updated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel task-section">
      <div className="panel-heading">
        <h2>Proposed revision</h2>
        <Link className="text-link" href={`${REVISION_PATHS[target].page}/${recordId}`}>Open {target} →</Link>
      </div>
      <p className="muted task-review-status">{revisionStatusText(status, target)}</p>
      {pending && editedSince ? (
        <p className="form-error" role="status">
          The {target} was edited after this revision was drafted.
          The left column shows the version the Copywriter worked from; accepting replaces the current text.
        </p>
      ) : null}

      <div className="task-text-compare">
        <article>
          <p className="task-text-compare-label">{status === "accepted" ? "Previous version" : "Current version"}</p>
          <h3><DiffText fallback={previous.title} kind="removed" segments={titleDiff?.before ?? null} /></h3>
          <div className="task-text-compare-body">
            <DiffText fallback={previous.body} kind="removed" segments={bodyDiff?.before ?? null} />
          </div>
        </article>
        <article className="task-text-compare-new">
          <p className="task-text-compare-label">{status === "accepted" ? "Applied revision" : "Proposed revision"}</p>
          <h3><DiffText fallback={proposed.title} kind="added" segments={titleDiff?.after ?? null} /></h3>
          <div className="task-text-compare-body">
            <DiffText fallback={proposed.body} kind="added" segments={bodyDiff?.after ?? null} />
          </div>
        </article>
      </div>

      {error ? <p className="form-error" role="alert">{error}</p> : null}

      {canAct && pending ? (
        <div className="task-actions">
          <button className="button button-secondary button-danger" disabled={busy} onClick={() => void resolve("discard")} type="button">
            Discard
          </button>
          <button className="button button-primary" disabled={busy} onClick={() => void resolve("accept")} type="button">
            {busy ? "Saving…" : `Accept & overwrite ${target}`}
          </button>
        </div>
      ) : null}
    </section>
  );
}
