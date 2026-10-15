import "server-only";
import { Prisma, TaskSource, TaskStatus, UserRole, type User } from "@prisma/client";
import { prisma } from "@/lib/db";

// The Task registry (see prisma/schema.prisma) lists every long-running operation. Rows are
// maintained by database triggers on AgentTask, BusinessImportTask and ReachoutTask; the
// helpers here only read them.

export type RegistryTaskRef = { id: number; name: string };

/** Administrators see every task; everyone else sees the tasks they launched. */
export function getTaskScope(user: Pick<User, "id" | "role">): Prisma.TaskWhereInput {
  return user.role === UserRole.ADMIN ? {} : { createdByUserId: user.id };
}

/** Number of the user's own tasks that are queued or ongoing (shown on the sidebar link). */
export function countActiveTasks(userId: string) {
  return prisma.task.count({
    where: { createdByUserId: userId, status: { in: [TaskStatus.PENDING, TaskStatus.RUNNING] } },
  });
}

export async function getRegistryTask(
  where: { agentTaskId: string } | { businessImportTaskId: string } | { reachoutTaskId: string },
): Promise<RegistryTaskRef> {
  const task = await prisma.task.findUnique({ where, select: { id: true, name: true } });
  if (!task) throw new Error("The task was created but is missing from the task registry.");
  return task;
}

/** The task page layout used for a task, chosen from its source, agent, and result. */
export type TaskTemplate =
  | "business-import"
  | "reachout"
  | "layout"
  | "creative"
  | "email-draft"
  | "review"
  | "promotion"
  | "sale"
  | "generic";

export function getTaskTemplate(source: TaskSource, agentSlug: string | null, result: unknown): TaskTemplate {
  if (source === TaskSource.BUSINESS_IMPORT) return "business-import";
  if (source === TaskSource.REACHOUT) return "reachout";
  if (agentSlug === "designer") return "layout";
  if (agentSlug === "creative") return "creative";
  const record = typeof result === "object" && result !== null ? (result as Record<string, unknown>) : {};
  if (record.contentType === "promotion") return "promotion";
  if (record.contentType === "sale") return "sale";
  if (typeof record.emailTo === "string") return "email-draft";
  if (record.contentType === "submission" || record.contentType === "article") return "review";
  return "generic";
}
