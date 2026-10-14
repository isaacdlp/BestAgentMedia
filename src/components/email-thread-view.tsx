"use client";

import { useCallback, useEffect, useState } from "react";
import { ClientListToolbar } from "@/components/list-toolbar";
import { ClientListPagination } from "@/components/list-pagination";

type EmailMessage = {
  id: string;
  messageId: string;
  direction: "OUTBOUND" | "INBOUND";
  fromEmail: string;
  toEmail: string;
  subject: string;
  bodyText: string;
  sentAt: string | null;
  receivedAt: string | null;
  createdAt: string;
};

type EmailThread = {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  createdAt: string;
  updatedAt: string;
  messages: EmailMessage[];
};

type ThreadSummary = {
  id: string;
  toEmail: string;
  toName: string | null;
  subject: string;
  createdAt: string;
  updatedAt: string;
  _count: { messages: number };
  messages: { direction: "OUTBOUND" | "INBOUND"; createdAt: string }[];
};

function MessageBubble({ msg }: { msg: EmailMessage }) {
  const [expanded, setExpanded] = useState(true);
  const isOutbound = msg.direction === "OUTBOUND";
  const time = msg.sentAt ?? msg.receivedAt ?? msg.createdAt;

  return (
    <div className={`email-bubble ${isOutbound ? "email-bubble-out" : "email-bubble-in"}`}>
      <div className="email-bubble-header">
        <span className="email-bubble-from">{isOutbound ? `From: ${msg.fromEmail}` : `From: ${msg.fromEmail}`}</span>
        <span className="email-bubble-time muted">{new Date(time).toLocaleString()}</span>
        <span className={`email-direction-badge ${isOutbound ? "email-direction-out" : "email-direction-in"}`}>
          {isOutbound ? "Sent" : "Received"}
        </span>
        <button
          className="email-bubble-toggle"
          onClick={() => setExpanded((v) => !v)}
          type="button"
        >
          {expanded ? "▲" : "▼"}
        </button>
      </div>
      {expanded ? (
        <div className="email-bubble-body">
          <pre className="email-bubble-text">{msg.bodyText}</pre>
          <p className="email-bubble-msgid muted">Message-ID: {msg.messageId}</p>
        </div>
      ) : null}
    </div>
  );
}

function ThreadDetail({
  subAgentId,
  threadId,
  onBack,
}: {
  subAgentId: number;
  threadId: string;
  onBack: () => void;
}) {
  const [thread, setThread] = useState<EmailThread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/sub-agents/${subAgentId}/threads/${threadId}`);
      const data = (await res.json()) as EmailThread | { error: string };
      if (!res.ok) throw new Error("error" in data ? data.error : "Failed to load thread.");
      setThread(data as EmailThread);
      setError("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load thread.");
    } finally {
      setLoading(false);
    }
  }, [subAgentId, threadId]);

  // Load on mount
  if (loading && !thread) {
    void load();
  }

  return (
    <div className="email-thread-detail">
      <div className="email-thread-nav">
        <button className="button button-secondary button-small" onClick={onBack} type="button">
          ← All threads
        </button>
        {thread ? (
          <button className="button button-secondary button-small" onClick={() => void load()} type="button">
            Refresh
          </button>
        ) : null}
      </div>
      {loading && !thread ? <p className="muted">Loading…</p> : null}
      {error ? <p className="form-error">{error}</p> : null}
      {thread ? (
        <>
          <div className="email-thread-title-row">
            <h3 className="email-thread-subject">{thread.subject}</h3>
            <span className="muted">{thread.toName ? `${thread.toName} <${thread.toEmail}>` : thread.toEmail}</span>
          </div>
          <div className="email-thread-messages">
            {thread.messages.length ? (
              thread.messages.map((msg) => <MessageBubble key={msg.id} msg={msg} />)
            ) : (
              <p className="muted">No messages yet.</p>
            )}
          </div>
        </>
      ) : null}
    </div>
  );
}

const THREAD_SORT_OPTIONS = [
  { label: "Updated", value: "updatedAt" },
  { label: "Subject", value: "subject" },
  { label: "Recipient", value: "toEmail" },
];

export function EmailThreadList({ subAgentId }: { subAgentId: number }) {
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("updatedAt");
  const [order, setOrder] = useState<"asc" | "desc">("desc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(50);

  const refresh = useCallback(async () => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    params.set("sort", sort);
    params.set("order", order);
    params.set("page", String(page));
    params.set("limit", String(limit));
    try {
      const res = await fetch(`/api/sub-agents/${subAgentId}/threads?${params.toString()}`);
      const data = (await res.json()) as { items: ThreadSummary[]; total: number } | { error: string };
      if (!res.ok || !("items" in data)) throw new Error("error" in data ? data.error : "Refresh failed.");
      setThreads(data.items);
      setTotal(data.total);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Refresh failed.");
    }
  }, [subAgentId, q, sort, order, page, limit]);

  useEffect(() => {
    const id = setTimeout(() => { void refresh(); }, q ? 300 : 0);
    return () => clearTimeout(id);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subAgentId, q, sort, order, page, limit]);

  if (selectedId) {
    return (
      <ThreadDetail
        onBack={() => setSelectedId(null)}
        subAgentId={subAgentId}
        threadId={selectedId}
      />
    );
  }

  return (
    <div className="email-thread-list-wrap">
      <div className="email-thread-list-header">
        <h3>Email Threads <span className="count-badge">{total}</span></h3>
        <button className="button button-secondary button-small" onClick={() => void refresh()} type="button">
          Refresh
        </button>
      </div>
      <ClientListToolbar
        q={q} onQChange={(v) => { setQ(v); setPage(1); }}
        sort={sort} onSortChange={(v) => { setSort(v); setPage(1); }}
        order={order} onOrderChange={(v) => { setOrder(v); setPage(1); }}
        limit={limit} onLimitChange={(v) => { setLimit(v); setPage(1); }}
        sortOptions={THREAD_SORT_OPTIONS}
      />
      {error ? <p className="form-error">{error}</p> : null}
      {threads.length ? (
        <div className="email-thread-list">
          {threads.map((t) => {
            const lastMsg = t.messages[0];
            const isUnread = lastMsg?.direction === "INBOUND";
            return (
              <button
                className={`email-thread-row ${isUnread ? "email-thread-row-unread" : ""}`}
                key={t.id}
                onClick={() => setSelectedId(t.id)}
                type="button"
              >
                <div className="email-thread-row-info">
                  <span className="email-thread-row-to">
                    {t.toName ? `${t.toName} <${t.toEmail}>` : t.toEmail}
                  </span>
                  <span className="email-thread-row-subject">{t.subject}</span>
                </div>
                <div className="email-thread-row-meta">
                  <span className="muted">{new Date(t.updatedAt).toLocaleDateString()}</span>
                  <span className="count-badge">{t._count.messages}</span>
                  {isUnread ? <span className="email-unread-dot" aria-label="New reply" /> : null}
                </div>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="muted">{q ? `No threads match "${q}".` : "No threads yet. Send an email to start a conversation."}</p>
      )}
      <ClientListPagination total={total} page={page} limit={limit} onPageChange={setPage} />
    </div>
  );
}
