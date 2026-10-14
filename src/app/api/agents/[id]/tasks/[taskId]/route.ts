import { AgentTaskStatus, UserRole } from "@prisma/client";
import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { prisma } from "@/lib/db";

type Params = { params: Promise<{ id: string; taskId: string }> };

export async function PATCH(request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage agent tasks." }, { status: 401 });
  if (user.role !== UserRole.ADMIN) return NextResponse.json({ error: "Administrators only." }, { status: 403 });

  const { id, taskId } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  if (!/^[\w-]{1,64}$/.test(taskId)) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, agentId: Number(id) },
    select: { id: true, status: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  if (task.status !== AgentTaskStatus.PENDING && task.status !== AgentTaskStatus.RUNNING) {
    return NextResponse.json({ error: "Only pending or running tasks can be stopped." }, { status: 409 });
  }

  await prisma.agentTask.update({
    where: { id: taskId },
    data: {
      status: AgentTaskStatus.STOPPED,
      completedAt: new Date(),
    },
  });

  return NextResponse.json({ message: "Task stopped." });
}

export async function DELETE(_request: Request, { params }: Params) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "Sign in to manage agent tasks." }, { status: 401 });
  if (user.role !== UserRole.ADMIN) return NextResponse.json({ error: "Administrators only." }, { status: 403 });

  const { id, taskId } = await params;
  if (!/^[1-9]\d*$/.test(id)) return NextResponse.json({ error: "Agent not found." }, { status: 404 });
  if (!/^[\w-]{1,64}$/.test(taskId)) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  const task = await prisma.agentTask.findFirst({
    where: { id: taskId, agentId: Number(id) },
    select: { id: true },
  });
  if (!task) return NextResponse.json({ error: "Task not found." }, { status: 404 });

  await prisma.agentTask.delete({ where: { id: taskId } });

  return NextResponse.json({ message: "Task deleted." });
}
