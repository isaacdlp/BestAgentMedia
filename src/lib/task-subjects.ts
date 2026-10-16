import "server-only";
import { AgentTaskStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { step, type TaskStep } from "@/lib/agent-task-runner";

export type TaskSubjectType = "submission" | "article" | "ad";

/**
 * Stops the queued or running tasks that work on a submission, article or ad. Called when the
 * record is moved to Accepted: its agents have nothing left to do for it. Tasks are matched by
 * their recorded subject, by the reference saved in their result, and (for ads and articles) by
 * the promotion deals and sales that carry them.
 */
export async function stopTasksForSubject(type: TaskSubjectType, id: string): Promise<number> {
  const linked: Prisma.AgentTaskWhereInput[] = [
    { subjectType: type, subjectId: id },
    ...(type === "ad"
      ? [
          { result: { path: ["parentId"], equals: id } } satisfies Prisma.AgentTaskWhereInput,
          { promotionDeal: { is: { advertisementId: id } } },
          { promotionSale: { is: { items: { some: { advertisementId: id } } } } },
        ]
      : [{ result: { path: ["referenceId"], equals: id } } satisfies Prisma.AgentTaskWhereInput]),
    ...(type === "article"
      ? [
          { result: { path: ["parentId"], equals: id } } satisfies Prisma.AgentTaskWhereInput,
          { promotionDeal: { is: { articleId: id } } },
          { promotionSale: { is: { items: { some: { articleId: id } } } } },
        ]
      : []),
  ];

  const tasks = await prisma.agentTask.findMany({
    where: { status: { in: [AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING] }, OR: linked },
    select: { id: true, steps: true },
  });

  const now = new Date();
  let stopped = 0;
  for (const task of tasks) {
    const steps = Array.isArray(task.steps) ? (task.steps as unknown as TaskStep[]) : [];
    const { count } = await prisma.agentTask.updateMany({
      where: { id: task.id, status: { in: [AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING] } },
      data: {
        status: AgentTaskStatus.STOPPED,
        completedAt: now,
        steps: [...steps, step("info", `Stopped automatically: the ${type} was accepted`)] as unknown as Prisma.InputJsonValue,
      },
    });
    stopped += count;
  }
  return stopped;
}
