import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { UserRole } from "@prisma/client";
import { requireUser } from "@/lib/auth";
import { ListToolbar } from "@/components/list-toolbar";
import { ListPagination } from "@/components/list-pagination";
import { parseListParams } from "@/lib/list-params";
import { prisma } from "@/lib/db";

const SORT_OPTIONS = [
  { label: "Name", value: "name" },
];

export default async function AgentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (user.role !== UserRole.ADMIN) redirect("/dashboard");

  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "name", "asc");

  const where = q
    ? {
        OR: [
          { name: { contains: q, mode: "insensitive" as const } },
          { description: { contains: q, mode: "insensitive" as const } },
        ],
      }
    : {};

  const [agents, total] = await Promise.all([
    prisma.agent.findMany({
      where,
      orderBy: [{ [sort || "name"]: order }],
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        slug: true,
        description: true,
        enabled: true,
        updatedAt: true,
        _count: { select: { tasks: true } },
        tasks: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { status: true, createdAt: true },
        },
      },
    }),
    prisma.agent.count({ where }),
  ]);

  return (
    <>
      <div className="page-heading">
        <div>
          <p className="eyebrow">ADMINISTRATION</p>
          <h1>Agents</h1>
          <p className="muted">Configure and monitor AI agents that assist the publication workflow.</p>
        </div>
        <span className="role-pill">{total} agent{total !== 1 ? "s" : ""}</span>
      </div>

      <section className="panel agent-list-panel">
        <div className="panel-heading">
          <h2>All agents <span className="count-badge">{total}</span></h2>
        </div>
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="name" defaultOrder="asc" />
        </Suspense>
        {agents.length ? (
          <div className="agent-list">
            {agents.map((agent) => {
              const lastTask = agent.tasks[0];
              return (
                <Link className="agent-card" href={`/agents/${agent.id}`} key={agent.id}>
                  <div className="agent-card-header">
                    <div className="agent-card-title-row">
                      <h3 className="agent-card-name">{agent.name}</h3>
                      <span className={`agent-status-badge ${agent.enabled ? "agent-status-enabled" : "agent-status-disabled"}`}>
                        {agent.enabled ? "Enabled" : "Disabled"}
                      </span>
                    </div>
                    <p className="agent-card-desc">{agent.description}</p>
                  </div>
                  <div className="agent-card-meta">
                    <span className="muted">{agent._count.tasks} task{agent._count.tasks !== 1 ? "s" : ""}</span>
                    {lastTask ? (
                      <span className={`agent-task-status-chip agent-task-status-${lastTask.status.toLowerCase()}`}>
                        Last: {formatStatus(lastTask.status)} · {new Date(lastTask.createdAt).toLocaleDateString()}
                      </span>
                    ) : (
                      <span className="muted">No tasks yet</span>
                    )}
                  </div>
                </Link>
              );
            })}
          </div>
        ) : (
          <div className="empty-state">{q ? `No agents match "${q}".` : `No agents are configured. Run <code>npm run db:seed</code> to add them.`}</div>
        )}
        <Suspense>
          <ListPagination total={total} page={page} limit={limit} />
        </Suspense>
      </section>
    </>
  );
}

function formatStatus(status: string) {
  return status.charAt(0) + status.slice(1).toLowerCase();
}
