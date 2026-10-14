import "server-only";
import { after } from "next/server";
import { AgentTaskStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { getRegistryTask, type RegistryTaskRef } from "@/lib/tasks";

export type TaskStep = { at: string; level: "info" | "success" | "error"; message: string };

export function step(level: TaskStep["level"], message: string): TaskStep {
  return { at: new Date().toISOString(), level, message };
}

export type AgentTaskContext = {
  agentTaskId: string;
  /** Appends a step to the task log; progress is persisted so the task page can show it live. */
  log: (level: TaskStep["level"], message: string) => void;
};

/**
 * Launches an agent job as a background Task: records a RUNNING AgentTask, schedules `work`
 * to run after the response is sent, and returns the registry task for the caller to return.
 * `work` returns the task result; throwing marks the task FAILED with the error message.
 * A task stopped by a user while running keeps its STOPPED status.
 */
export async function launchAgentTask({
  agentId,
  label,
  triggeredById,
  issueId,
  steps: initialSteps = [],
  work,
}: {
  /** Null for work that does not belong to any agent. */
  agentId: number | null;
  label: string;
  triggeredById?: string | null;
  issueId?: string | null;
  steps?: TaskStep[];
  work: (context: AgentTaskContext) => Promise<unknown>;
}): Promise<RegistryTaskRef> {
  const steps = [...initialSteps];
  const agentTask = await prisma.agentTask.create({
    data: {
      agentId,
      status: AgentTaskStatus.RUNNING,
      label,
      issueId: issueId ?? null,
      triggeredById: triggeredById ?? null,
      startedAt: new Date(),
      steps: steps as unknown as Prisma.InputJsonValue,
    },
    select: { id: true },
  });

  after(() => executeAgentTask(agentTask.id, steps, work));

  return getRegistryTask({ agentTaskId: agentTask.id });
}

async function executeAgentTask(
  agentTaskId: string,
  steps: TaskStep[],
  work: (context: AgentTaskContext) => Promise<unknown>,
) {
  const whileRunning = { id: agentTaskId, status: AgentTaskStatus.RUNNING };

  function log(level: TaskStep["level"], message: string) {
    steps.push(step(level, message));
    void prisma.agentTask
      .updateMany({ where: whileRunning, data: { steps: [...steps] as unknown as Prisma.InputJsonValue } })
      .catch(() => undefined);
  }

  try {
    const result = await work({ agentTaskId, log });
    await prisma.agentTask.updateMany({
      where: whileRunning,
      data: {
        status: AgentTaskStatus.SUCCEEDED,
        completedAt: new Date(),
        steps: steps as unknown as Prisma.InputJsonValue,
        ...(result === undefined ? {} : { result: result as Prisma.InputJsonValue }),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Agent task ${agentTaskId} failed:`, error);
    steps.push(step("error", `Failed: ${message}`));
    await prisma.agentTask
      .updateMany({
        where: whileRunning,
        data: {
          status: AgentTaskStatus.FAILED,
          error: message,
          completedAt: new Date(),
          steps: steps as unknown as Prisma.InputJsonValue,
        },
      })
      .catch((updateError: unknown) => console.error(`Could not record failure of task ${agentTaskId}:`, updateError));
  }
}
