"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ClientListToolbar } from "@/components/list-toolbar";
import { ClientListPagination } from "@/components/list-pagination";

type TaskStep = { at: string; level: "info" | "success" | "error"; message: string };

type TaskResult = {
  // Designer
  pageCount?: number;
  elementCount?: number;
  inputTokens?: number;
  outputTokens?: number;
  thinkingTokens?: number;
  // Assistant / Marketer shared
  trigger?: "submission" | "business" | "marketer";
  pitchType?: "sponsored_article" | "advertisement";
  referenceId?: string | number;
  emailTo?: string;
  emailSubject?: string;
  bodyPreview?: string;
  status?: "draft" | "sent";
  threadId?: string;
  sentTo?: string;
  // Clarification (assistant)
  contentType?: "submission" | "article" | "clarification";
  editUrl?: string;
  missingElements?: string[];
  // Editor
  referenceTitle?: string;
  headlineSuggestion?: string | null;
  summary?: string | null;
  strengths?: string[];
  suggestions?: string[];
  readabilityScore?: number | null;
  communityRelevanceScore?: number | null;
  // Delta (re-review)
  previousReviewId?: string;
  deltaReadability?: number | null;
  deltaCommunityRelevance?: number | null;
  resolvedElements?: string[];
  newConcerns?: string[];
};

export type SubAgentOption = { id: number; name: string };

export type AgentTaskSummary = {
  id: string;
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "STOPPED";
  label: string;
  steps: TaskStep[];
  result: TaskResult | null;
  error: string | null;
  issueId: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  triggeredBy: { name: string; surname: string } | null;
};

function durationLabel(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt) return "";
  const start = new Date(startedAt).getTime();
  const end = completedAt ? new Date(completedAt).getTime() : Date.now();
  const seconds = Math.round((end - start) / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function TaskStepLog({ steps }: { steps: TaskStep[] }) {
  if (!steps.length) return <p className="muted agent-task-no-steps">No steps recorded.</p>;
  return (
    <ol className="agent-task-steps">
      {steps.map((s, i) => (
        <li className={`agent-task-step agent-task-step-${s.level}`} key={i}>
          <span className="agent-task-step-time">{new Date(s.at).toLocaleTimeString()}</span>
          <span className="agent-task-step-msg">{s.message}</span>
        </li>
      ))}
    </ol>
  );
}

function DeltaBadge({ value }: { value: number | null | undefined }) {
  if (value == null || value === 0) return null;
  const sign = value > 0 ? "+" : "";
  const cls = value > 0 ? "delta-badge delta-badge-up" : "delta-badge delta-badge-down";
  return <span className={cls}>{sign}{value}</span>;
}

function TaskResultSummary({ result, agentId }: { result: TaskResult; agentId: number }) {
  if (result.emailTo) {
    const pitchLabel =
      result.pitchType === "sponsored_article"
        ? "Sponsored article pitch"
        : result.pitchType === "advertisement"
          ? "Advertisement pitch"
          : result.contentType === "clarification"
            ? "Info request"
            : null;
    return (
      <div className="agent-task-email-result">
        {pitchLabel ? (
          <p className="agent-task-email-row">
            <span className="agent-task-email-label">Type</span>
            <span>{pitchLabel}</span>
          </p>
        ) : null}
        <p className="agent-task-email-row">
          <span className="agent-task-email-label">To</span>
          <span>{result.emailTo}</span>
        </p>
        <p className="agent-task-email-row">
          <span className="agent-task-email-label">Subject</span>
          <span>{result.emailSubject}</span>
        </p>
        {result.bodyPreview ? (
          <details className="agent-task-email-body-details">
            <summary className="agent-task-email-label agent-task-email-body-toggle">Preview message</summary>
            <pre className="agent-task-email-body-preview">{result.bodyPreview}</pre>
            {result.editUrl ? (
              <p className="agent-task-email-edit-link">
                <span className="agent-task-email-label">Edit link</span>
                <a className="text-link" href={result.editUrl}>{result.editUrl}</a>
              </p>
            ) : null}
          </details>
        ) : null}
        {result.status === "sent" && result.threadId ? (
          <a className="text-link" href={`/agents/${agentId}/sub-agents`} style={{ fontSize: 12, marginTop: 4, display: "inline-block" }}>
            View conversation →
          </a>
        ) : result.status === "draft" ? (
          <span className="agent-task-draft-badge">Draft — not sent</span>
        ) : null}
      </div>
    );
  }
  if (result.contentType === "submission" || result.contentType === "article") {
    const hasDelta = result.previousReviewId != null;
    return (
      <div className="agent-task-editor-result">
        {result.summary ? <p className="agent-task-editor-summary">{result.summary}</p> : null}
        {result.readabilityScore !== null && result.readabilityScore !== undefined ? (
          <p className="agent-task-result">
            Readability: {result.readabilityScore}/10
            <DeltaBadge value={result.deltaReadability} />
            {" · "}
            Community relevance: {result.communityRelevanceScore ?? "?"}/10
            <DeltaBadge value={result.deltaCommunityRelevance} />
            {result.inputTokens !== undefined ? ` · ${result.inputTokens} in / ${result.outputTokens ?? 0} out tokens` : ""}
          </p>
        ) : null}
        {hasDelta && (result.resolvedElements?.length || result.newConcerns?.length) ? (
          <div className="agent-task-editor-section agent-task-delta-section">
            <p className="agent-task-email-label">Changes since last review</p>
            {result.resolvedElements && result.resolvedElements.length > 0 ? (
              <ul className="agent-task-editor-list agent-task-delta-resolved">
                {result.resolvedElements.map((s, i) => (
                  <li key={i} className="delta-resolved">✓ Resolved: {s}</li>
                ))}
              </ul>
            ) : null}
            {result.newConcerns && result.newConcerns.length > 0 ? (
              <ul className="agent-task-editor-list agent-task-delta-concerns">
                {result.newConcerns.map((s, i) => (
                  <li key={i} className="delta-concern">↑ New: {s}</li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : hasDelta ? (
          <p className="agent-task-result muted">No changes to missing elements since last review.</p>
        ) : null}
        {result.headlineSuggestion ? (
          <p className="agent-task-editor-headline">
            <span className="agent-task-email-label">Headline suggestion</span>
            {result.headlineSuggestion}
          </p>
        ) : null}
        {result.strengths && result.strengths.length > 0 ? (
          <div className="agent-task-editor-section">
            <p className="agent-task-email-label">Strengths</p>
            <ul className="agent-task-editor-list">
              {result.strengths.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        ) : null}
        {result.suggestions && result.suggestions.length > 0 ? (
          <div className="agent-task-editor-section">
            <p className="agent-task-email-label">Suggestions</p>
            <ul className="agent-task-editor-list">
              {result.suggestions.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        ) : null}
        {result.missingElements && result.missingElements.length > 0 ? (
          <div className="agent-task-editor-section">
            <p className="agent-task-email-label">Missing elements</p>
            <ul className="agent-task-editor-list">
              {result.missingElements.map((s, i) => <li key={i}>{s}</li>)}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }
  const parts: string[] = [];
  if (result.pageCount !== undefined) parts.push(`${result.pageCount} pages`);
  if (result.elementCount !== undefined) parts.push(`${result.elementCount} elements`);
  if (result.inputTokens !== undefined) parts.push(`${result.inputTokens} in / ${result.outputTokens ?? 0} out tokens`);
  if (!parts.length) return null;
  return <p className="agent-task-result">{parts.join(" · ")}</p>;
}

function AgentTaskCard({
  task,
  agentId,
  subAgents,
  onStop,
  onDelete,
  onRefresh,
  busyId,
}: {
  task: AgentTaskSummary;
  agentId: number;
  subAgents: SubAgentOption[];
  onStop: (t: AgentTaskSummary) => void;
  onDelete: (t: AgentTaskSummary) => void;
  onRefresh: () => void;
  busyId: string | null;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [redeploying, setRedeploying] = useState(false);
  const [redeployError, setRedeployError] = useState("");
  const [selectedSubAgentId, setSelectedSubAgentId] = useState<number>(subAgents[0]?.id ?? 0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState("");
  const isActive = task.status === "PENDING" || task.status === "RUNNING";
  const canRedeploy = task.status === "SUCCEEDED" && task.issueId &&
    !!(task.result as Record<string, unknown> | null)?.design;
  const result = task.result as TaskResult | null;
  const canSend = task.status === "SUCCEEDED" && result?.emailTo && result?.status === "draft" && subAgents.length > 0;
  const duration = durationLabel(task.startedAt, task.completedAt);
  const triggeredByName = task.triggeredBy
    ? [task.triggeredBy.name, task.triggeredBy.surname].filter(Boolean).join(" ")
    : "Unknown";
  const steps = Array.isArray(task.steps) ? (task.steps as TaskStep[]) : [];

  async function handleRedeploy() {
    setRedeploying(true);
    setRedeployError("");
    try {
      const response = await fetch(`/api/agents/${agentId}/tasks/${task.id}/redeploy`, { method: "POST" });
      const result = (await response.json()) as { issueId?: string; error?: string };
      if (!response.ok) throw new Error(result.error ?? "Redeploy failed.");
      router.push(`/issues/${result.issueId ?? task.issueId ?? ""}`);
    } catch (err) {
      setRedeployError(err instanceof Error ? err.message : "Redeploy failed.");
    } finally {
      setRedeploying(false);
    }
  }

  async function handleSend() {
    if (!selectedSubAgentId) return;
    setSending(true);
    setSendError("");
    try {
      const response = await fetch(`/api/agents/${agentId}/tasks/${task.id}/send`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subAgentId: selectedSubAgentId }),
      });
      const res = (await response.json()) as { threadId?: string; sentTo?: string; error?: string };
      if (!response.ok) throw new Error(res.error ?? "Send failed.");
      onRefresh();
    } catch (err) {
      setSendError(err instanceof Error ? err.message : "Send failed.");
    } finally {
      setSending(false);
    }
  }

  return (
    <article className="agent-task-card">
      <div className="agent-task-card-header">
        <div className="agent-task-card-title-row">
          <span className={`agent-task-status-chip agent-task-status-${task.status.toLowerCase()}`}>
            {task.status.charAt(0) + task.status.slice(1).toLowerCase()}
          </span>
          <h3 className="agent-task-label">{task.label}</h3>
        </div>
        <div className="agent-task-card-meta">
          <span className="muted">
            {new Date(task.createdAt).toLocaleString()}
            {duration ? ` · ${duration}` : ""}
            {" · by "}{triggeredByName}
          </span>
          {task.issueId ? (
            <a className="text-link agent-task-issue-link" href={`/issues/${task.issueId}`}>
              View issue →
            </a>
          ) : null}
        </div>
      </div>

      {task.error ? (
        <p className="form-error agent-task-error">{task.error}</p>
      ) : null}
      {redeployError ? (
        <p className="form-error agent-task-error">{redeployError}</p>
      ) : null}
      {sendError ? (
        <p className="form-error agent-task-error">{sendError}</p>
      ) : null}

      {task.result ? <TaskResultSummary agentId={agentId} result={task.result as TaskResult} /> : null}

      <div className="agent-task-card-footer">
        <button
          className="button button-secondary button-small agent-task-toggle-btn"
          onClick={() => setExpanded((v) => !v)}
          type="button"
        >
          {expanded ? "Hide steps" : `Show steps (${steps.length})`}
        </button>
        <div className="agent-task-actions">
          {canSend ? (
            <div className="agent-task-send-row">
              {subAgents.length > 1 ? (
                <select
                  className="agent-task-sub-agent-select"
                  onChange={(e) => setSelectedSubAgentId(Number(e.target.value))}
                  value={selectedSubAgentId}
                >
                  {subAgents.map((sa) => (
                    <option key={sa.id} value={sa.id}>{sa.name}</option>
                  ))}
                </select>
              ) : (
                <span className="agent-task-sub-agent-name">{subAgents[0]?.name}</span>
              )}
              <button
                className="button button-primary button-small"
                disabled={sending || busyId === task.id}
                onClick={() => void handleSend()}
                type="button"
              >
                {sending ? "Sending…" : "Send email"}
              </button>
            </div>
          ) : null}
          {canRedeploy ? (
            <button
              className="button button-primary button-small"
              disabled={redeploying || busyId === task.id}
              onClick={() => void handleRedeploy()}
              type="button"
              title="Apply this task's generated layout to the issue and open the editor"
            >
              {redeploying ? "Redeploying…" : "Redeploy to issue"}
            </button>
          ) : null}
          {isActive ? (
            <button
              className="button button-secondary button-small"
              disabled={busyId === task.id}
              onClick={() => onStop(task)}
              type="button"
            >
              Stop
            </button>
          ) : null}
          <button
            className="button button-secondary button-small agent-task-delete-btn"
            disabled={busyId === task.id}
            onClick={() => onDelete(task)}
            type="button"
          >
            Delete
          </button>
        </div>
      </div>

      {expanded ? (
        <div className="agent-task-steps-wrap">
          <TaskStepLog steps={steps} />
        </div>
      ) : null}
    </article>
  );
}

const TASK_SORT_OPTIONS = [
  { label: "Created", value: "createdAt" },
  { label: "Status", value: "status" },
  { label: "Label", value: "label" },
];

export function AgentTaskList({
  agentId,
  initialTasks,
  initialTotal = initialTasks.length,
  subAgents = [],
  emptyMessage,
}: {
  agentId: number;
  initialTasks: AgentTaskSummary[];
  initialTotal?: number;
  subAgents?: SubAgentOption[];
  emptyMessage?: string;
}) {
  const [tasks, setTasks] = useState<AgentTaskSummary[]>(initialTasks);
  const [total, setTotal] = useState(initialTotal);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  function buildUrl() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", sort);
    params.set("order", order);
    params.set("page", String(page));
    params.set("limit", String(limit));
    return `/api/agents/${agentId}/tasks?${params.toString()}`;
  }

  const refreshTasks = useCallback(async (url?: string) => {
    try {
      const response = await fetch(url ?? buildUrl(), { cache: "no-store" });
      const result = (await response.json()) as { items: AgentTaskSummary[]; total: number } | { error: string };
      if (!response.ok || !("items" in result)) {
        throw new Error("error" in result ? result.error : "Unable to refresh tasks.");
      }
      setTasks(result.items);
      setTotal(result.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unable to refresh tasks.");
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId, q, sort, order, page, limit]);

  // Re-fetch when filter/sort/page/limit changes (debounce q)
  useEffect(() => {
    const id = setTimeout(() => { void refreshTasks(); }, q ? 300 : 0);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, sort, order, page, limit]);

  // Auto-refresh while any task is active
  useEffect(() => {
    const hasActive = tasks.some((t) => t.status === "PENDING" || t.status === "RUNNING");
    if (!hasActive) return;
    const timer = window.setInterval(() => { void refreshTasks(); }, 3000);
    return () => window.clearInterval(timer);
  }, [tasks, refreshTasks]);

  const handleStop = useCallback(async (task: AgentTaskSummary) => {
    setBusyId(task.id);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/tasks/${task.id}`, { method: "PATCH" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not stop task.");
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not stop task.");
    } finally {
      setBusyId(null);
    }
  }, [agentId, refreshTasks]);

  const handleDelete = useCallback(async (task: AgentTaskSummary) => {
    if (!window.confirm(`Delete task "${task.label}"?`)) return;
    setBusyId(task.id);
    setError(null);
    try {
      const response = await fetch(`/api/agents/${agentId}/tasks/${task.id}`, { method: "DELETE" });
      const result = (await response.json()) as { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Could not delete task.");
      await refreshTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete task.");
    } finally {
      setBusyId(null);
    }
  }, [agentId, refreshTasks]);

  return (
    <section className="panel agent-tasks-panel" aria-live="polite">
      <div className="panel-heading">
        <h2>Tasks <span className="count-badge">{total}</span></h2>
        <button
          className="button button-secondary button-small"
          onClick={() => void refreshTasks()}
          type="button"
        >
          Refresh
        </button>
      </div>
      <ClientListToolbar
        q={q} onQChange={(v) => { setQ(v); setPage(1); }}
        sort={sort} onSortChange={(v) => { setSort(v); setPage(1); }}
        order={order} onOrderChange={(v) => { setOrder(v); setPage(1); }}
        limit={limit} onLimitChange={(v) => { setLimit(v); setPage(1); }}
        sortOptions={TASK_SORT_OPTIONS}
      />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {tasks.length ? (
        <div className="agent-task-list">
          {tasks.map((task) => (
            <AgentTaskCard
              agentId={agentId}
              busyId={busyId}
              key={task.id}
              onDelete={handleDelete}
              onRefresh={() => void refreshTasks()}
              onStop={handleStop}
              subAgents={subAgents}
              task={task}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">{q ? `No tasks match "${q}".` : (emptyMessage ?? "No tasks have been run yet.")}</div>
      )}
      <ClientListPagination total={total} page={page} limit={limit} onPageChange={setPage} />
    </section>
  );
}
