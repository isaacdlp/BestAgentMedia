import { NextResponse } from "next/server";
import {
  AgentTaskStatus,
  BusinessImportTaskStatus,
  ReachoutTaskStatus,
  TaskSource,
  UserRole,
} from "@prisma/client";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getTaskScope } from "@/lib/tasks";

type Params = { params: Promise<{ id: string }> };

async function findTask(params: Params["params"], user: NonNullable<Awaited<ReturnType<typeof getCurrentUser>>>) {
  const { id } = await params;
  if (!/^[1-9]\d*$/.test(id)) return null;
  return prisma.task.findFirst({
    where: { id: Number(id), ...getTaskScope(user) },
    select: { id: true, source: true, agentTaskId: true, businessImportTaskId: true, reachoutTaskId: true },
  });
}

/** Stops a queued or running task. Available to administrators and the user who launched it. */
export async function PATCH(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage tasks." }, { status: 401 });

  const task = await findTask(params, user);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const now = new Date();
  let stopped = 0;
  if (task.source === TaskSource.AGENT && task.agentTaskId) {
    ({ count: stopped } = await prisma.agentTask.updateMany({
      where: { id: task.agentTaskId, status: { in: [AgentTaskStatus.PENDING, AgentTaskStatus.RUNNING] } },
      data: { status: AgentTaskStatus.STOPPED, completedAt: now },
    }));
  } else if (task.source === TaskSource.BUSINESS_IMPORT && task.businessImportTaskId) {
    ({ count: stopped } = await prisma.businessImportTask.updateMany({
      where: { id: task.businessImportTaskId, status: BusinessImportTaskStatus.RUNNING },
      data: { status: BusinessImportTaskStatus.STOPPED, message: "Stopped by user.", finishedAt: now },
    }));
  } else if (task.source === TaskSource.REACHOUT && task.reachoutTaskId) {
    ({ count: stopped } = await prisma.reachoutTask.updateMany({
      where: { id: task.reachoutTaskId, status: { in: [ReachoutTaskStatus.PENDING, ReachoutTaskStatus.RUNNING] } },
      data: { status: ReachoutTaskStatus.STOPPED, message: "Stopped by user.", finishedAt: now },
    }));
  }
  if (!stopped) return NextResponse.json({ error: "This task is no longer running." }, { status: 409 });

  // The person who stopped it already knows; don't announce it back to them.
  await prisma.task.updateMany({ where: { id: task.id, createdByUserId: user.id }, data: { notifiedAt: now } });
  return NextResponse.json({ message: "Task stopped." });
}

/** Deletes a task and its backing record. Administrators only. */
export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage tasks." }, { status: 401 });
  if (user.role !== UserRole.ADMIN) return NextResponse.json({ error: "Administrators only." }, { status: 403 });

  const task = await findTask(params, user);
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  if (task.agentTaskId) await prisma.agentTask.delete({ where: { id: task.agentTaskId } });
  else if (task.businessImportTaskId) await prisma.businessImportTask.delete({ where: { id: task.businessImportTaskId } });
  else if (task.reachoutTaskId) await prisma.reachoutTask.delete({ where: { id: task.reachoutTaskId } });
  else await prisma.task.delete({ where: { id: task.id } });

  return NextResponse.json({ message: "Task deleted." });
}
