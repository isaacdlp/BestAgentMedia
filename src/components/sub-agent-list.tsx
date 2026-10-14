"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ClientListToolbar } from "@/components/list-toolbar";
import { ClientListPagination } from "@/components/list-pagination";
import { useBulkSelection, BulkActionBar, BulkCheckbox, bulkDelete, bulkDeleteMessage } from "@/components/bulk-select";

export type SubAgentSummary = {
  id: number;
  name: string;
  soul: string;
  picturePath: string | null;
  cellNumber: string | null;
  config: Record<string, unknown>;
  createdAt: string;
  _count: { emailThreads: number };
};

type SubAgentConfig = {
  smtpFromEmail?: string;
  smtpFromName?: string;
  smtpHost?: string;
  smtpPort?: number;
  smtpUser?: string;
  smtpPassword?: string;
  smtpSecure?: boolean;
  smtpRequireTls?: boolean;
  imapHost?: string;
  imapPort?: number;
  imapUser?: string;
  imapPassword?: string;
  imapSecure?: boolean;
};

function SubAgentAvatar({ subAgent, agentId }: { subAgent: SubAgentSummary; agentId: number }) {
  const [imgError, setImgError] = useState(false);
  if (subAgent.picturePath && !imgError) {
    return (
      <img
        alt={subAgent.name}
        className="sub-agent-avatar"
        onError={() => setImgError(true)}
        src={`/api/agents/${agentId}/sub-agents/${subAgent.id}/picture`}
      />
    );
  }
  return (
    <div className="sub-agent-avatar sub-agent-avatar-placeholder" aria-hidden="true">
      {subAgent.name.charAt(0).toUpperCase()}
    </div>
  );
}


export function SubAgentCard({
  subAgent,
  agentId,
  onRefresh,
  selected = false,
  onToggleSelect,
  disabled = false,
}: {
  subAgent: SubAgentSummary;
  agentId: number;
  onRefresh: () => void;
  selected?: boolean;
  onToggleSelect?: () => void;
  disabled?: boolean;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  async function handleDelete() {
    if (!window.confirm(`Delete sub agent "${subAgent.name}"? All email threads will also be deleted.`)) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch(`/api/agents/${agentId}/sub-agents/${subAgent.id}`, { method: "DELETE" });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) throw new Error(data.error ?? "Delete failed.");
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed.");
    } finally {
      setDeleting(false);
    }
  }

  const cfg = subAgent.config as SubAgentConfig;
  const hasSmtp = !!(cfg.smtpHost && cfg.smtpUser && cfg.smtpFromEmail);
  const hasImap = !!(cfg.imapHost && cfg.imapUser);

  return (
    <article className="sub-agent-card">
      <div className="sub-agent-card-header">
        {onToggleSelect ? (
          <BulkCheckbox
            checked={selected}
            disabled={disabled || deleting}
            label={`Select sub agent ${subAgent.name}`}
            onChange={onToggleSelect}
          />
        ) : null}
        <SubAgentAvatar agentId={agentId} subAgent={subAgent} />
        <div className="sub-agent-card-info">
          <h3 className="sub-agent-card-name">{subAgent.name}</h3>
          <div className="sub-agent-card-badges">
            <span className={`sub-agent-badge ${hasSmtp ? "sub-agent-badge-ok" : "sub-agent-badge-warn"}`}>
              SMTP {hasSmtp ? "✓" : "not set"}
            </span>
            <span className={`sub-agent-badge ${hasImap ? "sub-agent-badge-ok" : "sub-agent-badge-warn"}`}>
              IMAP {hasImap ? "✓" : "not set"}
            </span>
            <span className="sub-agent-badge sub-agent-badge-neutral">
              {subAgent._count.emailThreads} thread{subAgent._count.emailThreads !== 1 ? "s" : ""}
            </span>
          </div>
        </div>
      </div>
      <p className="sub-agent-soul-preview">{subAgent.soul.slice(0, 120)}{subAgent.soul.length > 120 ? "…" : ""}</p>
      {error ? <p className="form-error">{error}</p> : null}
      <div className="sub-agent-card-footer">
        <Link
          className="button button-secondary button-small"
          href={`/agents/${agentId}/sub-agents/${subAgent.id}`}
        >
          Configure
        </Link>
        <button
          className="button button-secondary button-small sub-agent-delete-btn"
          disabled={deleting}
          onClick={() => void handleDelete()}
          type="button"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>
    </article>
  );
}

const SUB_AGENT_SORT_OPTIONS = [
  { label: "Created", value: "createdAt" },
  { label: "Name", value: "name" },
];

export function SubAgentList({
  agentId,
  initialSubAgents,
  initialTotal = initialSubAgents.length,
}: {
  agentId: number;
  initialSubAgents: SubAgentSummary[];
  initialTotal?: number;
}) {
  const [subAgents, setSubAgents] = useState<SubAgentSummary[]>(initialSubAgents);
  const [total, setTotal] = useState(initialTotal);
  const [creating, setCreating] = useState(false);
  const [bulkBusy, setBulkBusy] = useState(false);
  const selection = useBulkSelection(subAgents.map((sa) => sa.id));
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("createdAt");
  const [order, setOrder] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);
  const router = useRouter();

  function buildUrl() {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", sort);
    params.set("order", order);
    params.set("page", String(page));
    params.set("limit", String(limit));
    return `/api/agents/${agentId}/sub-agents?${params.toString()}`;
  }

  const refresh = useCallback(async (url?: string) => {
    try {
      const res = await fetch(url ?? buildUrl());
      const data = (await res.json()) as { items: SubAgentSummary[]; total: number } | { error: string };
      if (!res.ok || !("items" in data)) throw new Error("error" in data ? data.error : "Refresh failed.");
      setSubAgents(data.items);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    }
  }, [agentId, q, sort, order, page, limit]);

  useEffect(() => {
    const id = setTimeout(() => { void refresh(); }, q ? 300 : 0);
    return () => clearTimeout(id);
  }, [q, sort, order, page, limit]);

  async function handleNew() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch(`/api/agents/${agentId}/sub-agents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = (await res.json()) as { id?: number; error?: string };
      if (!res.ok || !data.id) throw new Error(data.error ?? "Failed to create sub agent.");
      router.push(`/agents/${agentId}/sub-agents/${data.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed.");
      setCreating(false);
    }
  }

  async function handleBulkDelete() {
    const ids = selection.selectedIds;
    if (!ids.length) return;
    if (!window.confirm(`Delete ${ids.length} sub agent${ids.length === 1 ? "" : "s"}? All their email threads will also be deleted.`)) return;
    setBulkBusy(true);
    setError(null);
    const { deleted, failed } = await bulkDelete(ids, (id) => `/api/agents/${agentId}/sub-agents/${id}`);
    selection.clear();
    await refresh();
    const message = bulkDeleteMessage(failed, deleted.length);
    if (message) setError(message);
    setBulkBusy(false);
  }

  return (
    <section className="panel sub-agent-panel">
      <div className="panel-heading">
        <h2>Sub Agents <span className="count-badge">{total}</span></h2>
        <button className="button button-primary button-small" disabled={creating} onClick={() => void handleNew()} type="button">
          {creating ? "Creating…" : "+ New Sub Agent"}
        </button>
      </div>
      <ClientListToolbar
        q={q} onQChange={(v) => { setQ(v); setPage(1); }}
        sort={sort} onSortChange={(v) => { setSort(v); setPage(1); }}
        order={order} onOrderChange={(v) => { setOrder(v); setPage(1); }}
        limit={limit} onLimitChange={(v) => { setLimit(v); setPage(1); }}
        sortOptions={SUB_AGENT_SORT_OPTIONS}
      />
      {error ? <p className="form-error" role="alert">{error}</p> : null}
      {subAgents.length ? (
        <BulkActionBar
          allSelected={selection.allSelected}
          busy={bulkBusy}
          count={selection.selectedIds.length}
          onDelete={() => void handleBulkDelete()}
          onToggleAll={selection.toggleAll}
          someSelected={selection.someSelected}
        />
      ) : null}
      {subAgents.length ? (
        <div className="sub-agent-grid">
          {subAgents.map((sa) => (
            <SubAgentCard
              agentId={agentId}
              disabled={bulkBusy}
              key={sa.id}
              onRefresh={() => void refresh()}
              onToggleSelect={() => selection.toggle(sa.id)}
              selected={selection.isSelected(sa.id)}
              subAgent={sa}
            />
          ))}
        </div>
      ) : (
        <div className="empty-state">{q ? `No sub agents match "${q}".` : "No sub agents yet. Create one to start sending emails."}</div>
      )}
      <ClientListPagination total={total} page={page} limit={limit} onPageChange={setPage} />
    </section>
  );
}
