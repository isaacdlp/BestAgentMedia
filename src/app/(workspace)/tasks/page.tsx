import { Suspense } from "react";
import Link from "next/link";
import { Prisma, TaskSource, TaskStatus, UserRole } from "@prisma/client";
import { ListPagination } from "@/components/list-pagination";
import { ListToolbar } from "@/components/list-toolbar";
import { TaskBulkTable } from "@/components/task-bulk-table";
import { TaskAutoRefresh } from "@/components/task-auto-refresh";
import { requireUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { parseListParams } from "@/lib/list-params";
import { formatTaskDuration, isTaskActive, TASK_STATUS_LABELS } from "@/lib/task-status";
import { getTaskScope } from "@/lib/tasks";

const SORT_OPTIONS = [
  { label: "Date", value: "createdAt" },
  { label: "Task name", value: "name" },
  { label: "Agent type", value: "agent" },
  { label: "Status", value: "status" },
];

const STATUS_FILTERS: { label: string; statuses: TaskStatus[] | null; value: string }[] = [
  { label: "All", statuses: null, value: "" },
  { label: "Ongoing", statuses: [TaskStatus.PENDING, TaskStatus.RUNNING], value: "ongoing" },
  { label: "Success", statuses: [TaskStatus.SUCCEEDED], value: "success" },
  { label: "Error", statuses: [TaskStatus.FAILED], value: "error" },
  { label: "Stopped", statuses: [TaskStatus.STOPPED], value: "stopped" },
];

// Ongoing tasks that changed recently keep the list refreshing; long-lived ones (such as
// onboarding sequences waiting days for a reminder) do not.
const LIVE_UPDATE_WINDOW_MS = 10 * 60 * 1000;

const SOURCE_KEYWORDS: Record<TaskSource, string[]> = {
  AGENT: ["agent"],
  BUSINESS_IMPORT: ["import", "here", "here maps", "business import"],
  REACHOUT: ["onboarding", "outreach", "reachout"],
};

/** Task sources whose keywords contain, or are contained in, the search text. */
function matchTaskSources(q: string): TaskSource[] {
  const text = q.toLowerCase();
  if (text.length < 3) return [];
  return (Object.keys(SOURCE_KEYWORDS) as TaskSource[]).filter((source) =>
    SOURCE_KEYWORDS[source].some((keyword) => keyword.includes(text) || text.includes(keyword)),
  );
}

export default async function TasksPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  const isAdmin = user.role === UserRole.ADMIN;

  const sp = await searchParams;
  const { page, limit, skip, q, sort, order } = parseListParams(sp, "createdAt", "desc");
  const statusParam = typeof sp.status === "string" ? sp.status : "";
  const statusFilter = STATUS_FILTERS.find((filter) => filter.value === statusParam) ?? STATUS_FILTERS[0];

  const agentId = /^[1-9]d*$/.test(String(sp.agent ?? "")) ? Number(sp.agent) : null;
  const subAgentId = agentId && /^[1-9]d*$/.test(String(sp.subAgent ?? "")) ? Number(sp.subAgent) : null;
  const agentFilter = agentId
    ? await prisma.agent.findUnique({
        where: { id: agentId },
        select: {
          name: true,
          personaName: true,
          picturePath: true,
          subAgents: subAgentId
            ? { where: { id: subAgentId }, select: { name: true, picturePath: true } }
            : false,
        },
      })
    : null;

  const where: Prisma.TaskWhereInput = {
    ...getTaskScope(user),
    ...(agentFilter && agentId ? { agentId } : {}),
    ...(agentFilter && subAgentId
      ? { AND: [{ OR: [{ agentTask: { subAgentId } }, { reachoutTask: { subAgentId } }] }] }
      : {}),
    ...(statusFilter.statuses ? { status: { in: statusFilter.statuses } } : {}),
    ...(q
      ? {
          // Match everything a person can see or reasonably associate with a task, across all
          // pages: its name, agent, launcher, and source-specific details (provider, ZIP code,
          // categories, business name).
          OR: [
            { name: { contains: q, mode: "insensitive" as const } },
            { agent: { name: { contains: q, mode: "insensitive" as const } } },
            { createdBy: { name: { contains: q, mode: "insensitive" as const } } },
            { createdBy: { surname: { contains: q, mode: "insensitive" as const } } },
            ...matchTaskSources(q).map((source) => ({ source })),
            {
              businessImportTask: {
                OR: [
                  { sourceProvider: { contains: q, mode: "insensitive" as const } },
                  { zipCode: { contains: q } },
                  { categories: { has: q } },
                  { message: { contains: q, mode: "insensitive" as const } },
                ],
              },
            },
            {
              reachoutTask: {
                business: { name: { contains: q, mode: "insensitive" as const } },
              },
            },
          ],
        }
      : {}),
  };

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    sort === "name" ? [{ name: order }, { createdAt: "desc" }]
    : sort === "agent" ? [{ agent: { name: order } }, { createdAt: "desc" }]
    : sort === "status" ? [{ status: order }, { createdAt: "desc" }]
    : [{ createdAt: order }, { id: order }];

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      orderBy,
      skip,
      take: limit,
      select: {
        id: true,
        name: true,
        status: true,
        createdAt: true,
        finishedAt: true,
        updatedAt: true,
        agent: { select: { name: true } },
        createdBy: { select: { name: true, surname: true } },
      },
    }),
    prisma.task.count({ where }),
  ]);

  const now = Date.now();
  const hasLiveTasks = tasks.some(
    (task) => isTaskActive(task.status) && now - task.updatedAt.getTime() < LIVE_UPDATE_WINDOW_MS,
  );

  function filterHref(value: string) {
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(sp)) {
      if (typeof raw === "string" && key !== "status" && key !== "page") params.set(key, raw);
    }
    if (value) params.set("status", value);
    const query = params.toString();
    return query ? `/tasks?${query}` : "/tasks";
  }

  function clearAgentHref() {
    const params = new URLSearchParams();
    for (const [key, raw] of Object.entries(sp)) {
      if (typeof raw === "string" && !["agent", "subAgent", "page"].includes(key)) params.set(key, raw);
    }
    const query = params.toString();
    return query ? `/tasks?${query}` : "/tasks";
  }

  return (
    <>
      <TaskAutoRefresh active={hasLiveTasks} intervalMs={5_000} />
      <div className="page-heading">
        <div>
          <p className="eyebrow">ACTIVITY</p>
          <h1>Tasks</h1>
          <p className="muted">
            {isAdmin
              ? "Every long-running operation in the workspace — agent jobs, imports, and outreach."
              : "Long-running operations you have started — agent jobs, imports, and outreach."}{" "}
            You will be notified when each one finishes.
          </p>
        </div>
      </div>
      <section className="panel table-panel">
        <div className="panel-heading">
          <h2>
            {statusFilter.statuses ? `${statusFilter.label} tasks` : "All tasks"}{" "}
            <span className="count-badge">{total}</span>
          </h2>
          <nav aria-label="Filter by status" className="task-filter-chips">
            {STATUS_FILTERS.map((filter) => (
              <Link
                aria-current={filter.value === statusFilter.value ? "page" : undefined}
                className="task-filter-chip"
                href={filterHref(filter.value)}
                key={filter.value || "all"}
              >
                {filter.label}
              </Link>
            ))}
          </nav>
        </div>
        {agentFilter && agentId ? (
          <div className="task-agent-filter">
            <AgentFilterChip
              agentId={agentId}
              agentName={agentFilter.personaName || agentFilter.name}
              agentPicturePath={agentFilter.picturePath}
              clearHref={clearAgentHref()}
              sub={subAgentId && agentFilter.subAgents?.[0] ? { id: subAgentId, name: agentFilter.subAgents[0].name, picturePath: agentFilter.subAgents[0].picturePath } : null}
            />
          </div>
        ) : null}
        <Suspense>
          <ListToolbar sortOptions={SORT_OPTIONS} defaultSort="createdAt" defaultOrder="desc" />
        </Suspense>
        {tasks.length ? (
          <TaskBulkTable
            isAdmin={isAdmin}
            rows={tasks.map((task) => ({
              id: task.id,
              name: task.name,
              agentName: task.agent?.name ?? null,
              status: task.status,
              statusLabel: TASK_STATUS_LABELS[task.status],
              startedAt: task.createdAt.toISOString(),
              duration: formatTaskDuration(task.createdAt, task.finishedAt),
              launchedBy: task.createdBy
                ? [task.createdBy.name, task.createdBy.surname].filter(Boolean).join(" ")
                : null,
            }))}
          />
        ) : (
          <div className="empty-state">
            {q
              ? `No tasks match "${q}".`
              : statusFilter.statuses
                ? `No ${statusFilter.label.toLowerCase()} tasks.`
                : "No tasks yet. Agent jobs, business imports, and outreach you start will appear here."}
          </div>
        )}
        <Suspense>
          <ListPagination total={total} page={page} limit={limit} />
        </Suspense>
      </section>
    </>
  );
}

function AgentFilterChip({
  agentId,
  agentName,
  agentPicturePath,
  sub,
  clearHref,
}: {
  agentId: number;
  agentName: string;
  agentPicturePath: string | null;
  sub: { id: number; name: string; picturePath: string | null } | null;
  clearHref: string;
}) {
  const name = sub?.name ?? agentName;
  const pictureUrl = sub
    ? sub.picturePath
      ? `/api/agents/${agentId}/sub-agents/${sub.id}/picture?v=${encodeURIComponent(sub.picturePath)}`
      : null
    : agentPicturePath
      ? `/api/agents/${agentId}/picture?v=${encodeURIComponent(agentPicturePath)}`
      : null;
  return (
    <>
      <span className="agent-badge">
        {pictureUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="" className="agent-badge-picture" src={pictureUrl} />
        ) : (
          <span aria-hidden="true" className="agent-badge-picture agent-badge-placeholder">
            {name.charAt(0).toUpperCase()}
          </span>
        )}
        <span className="agent-badge-text">
          <span className="agent-badge-name">{name}</span>
          <span className="agent-badge-role muted">Showing this agent&apos;s tasks</span>
        </span>
      </span>
      <Link className="text-link" href={clearHref}>Show all tasks</Link>
    </>
  );
}
